"""
Customer records.

A customer appears in one of two ways:

  * From chat - upsert_from_chat(), when the agent captures a phone number or
    an email. It only ever FILLS BLANKS and never overwrites. Anyone can type
    anyone's number into a public chat, so chat must never be able to rewrite
    a record that already exists.
  * From the dashboard - create() and update(), by the owner.

The rules both paths share live in the database (migration 003): one record
per phone, one per email, phones as +<digits>, emails in lowercase, and chat
can never opt anyone in to marketing. This module turns the database's
refusals into two exceptions the callers can explain to a person.
"""

from __future__ import annotations

import logging
import re
from datetime import datetime, timezone

from app.db import db, one, rows

logger = logging.getLogger("aibh.customers")

# Postgres error codes, as supabase-py passes them through.
UNIQUE_VIOLATION = "23505"
CHECK_VIOLATION = "23514"

STATUSES = {"lead", "active", "inactive"}
CHANNELS = {"sms", "whatsapp", "email"}
CONSENTS = {"unknown", "opted_in", "opted_out"}

# What the owner may edit from the dashboard. Everything else - id,
# business_id, source, created_at, the consent columns - is set by the system.
EDITABLE = {
    "name",
    "phone",
    "email",
    "notes",
    "tags",
    "status_override",
    "membership_plan",
    "preferred_channel",
}

EMAIL_SHAPE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")


class DuplicateCustomer(Exception):
    """Another customer of this business already has that phone or email."""

    def __init__(self, field: str) -> None:
        self.field = field
        super().__init__(f"Another customer already has this {field}.")


class InvalidCustomer(Exception):
    """A value the database (or we) refused, e.g. a phone that is not +<digits>."""


def normalise_phone(raw: str | None) -> str | None:
    """
    Every way someone writes one number -> one stored value.

        '9876543210'        -> '+919876543210'   (assumes India, no country code)
        '98765 43210'       -> '+919876543210'
        '+91 98765 43210'   -> '+919876543210'
        '09876543210'       -> '+919876543210'   trunk prefix, as when dialling
        '0919876543210'     -> '+919876543210'   trunk prefix + country code
        '00919876543210'    -> '+919876543210'   international prefix

    Getting this wrong is not cosmetic. "One customer per phone" is a unique
    index on the stored string, so if '09876543210' and '9876543210' stored
    two different values, the same person would quietly become two customers
    with two histories - and the index would never notice.

    Returns None for anything that is not plausibly a phone number, so we never
    store junk the agent extracted from a sentence. 10 to 15 digits is the
    international range, and the database checks exactly the same thing.
    """
    if not raw:
        return None
    digits = "".join(ch for ch in str(raw) if ch.isdigit())

    # 00 is the international dialling prefix; a single leading 0 is the
    # national trunk prefix. Neither is part of the number. No country code
    # begins with 0, so stripping leading zeros can never eat a real digit.
    if digits.startswith("00"):
        digits = digits[2:]
    digits = digits.lstrip("0")

    if len(digits) == 10:
        digits = f"91{digits}"
    if len(digits) < 10 or len(digits) > 15:
        return None
    return f"+{digits}"


def normalise_email(raw: str | None) -> str | None:
    """' Ravi@Gmail.com ' -> 'ravi@gmail.com'. None if it is not email-shaped."""
    clean = (raw or "").strip().lower()
    return clean if EMAIL_SHAPE.match(clean) else None


def _explain(exc: Exception) -> Exception:
    """
    Turn a database refusal into DuplicateCustomer or InvalidCustomer.

    Anything else comes back unchanged and the caller re-raises it. A dead
    connection must never be reported to the owner as "duplicate phone".
    """
    text = str(exc)
    if UNIQUE_VIOLATION in text:
        if "phone" in text:
            return DuplicateCustomer("phone number")
        if "email" in text:
            return DuplicateCustomer("email address")
        return DuplicateCustomer("details")
    if CHECK_VIOLATION in text:
        return InvalidCustomer(text)
    return exc


def _run(query):
    """Execute a write, translating refusals. Returns the supabase response."""
    try:
        return query.execute()
    except Exception as exc:  # noqa: BLE001
        explained = _explain(exc)
        if explained is exc:
            raise
        raise explained from exc


# ---------------------------------------------------------------------- reads


def get(business_id: str, customer_id: str) -> dict | None:
    return one(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )


def get_by_phone(business_id: str, phone: str | None) -> dict | None:
    """
    Find a customer by phone number within one business.

    Normalises first, so '9876543210', '+91 98765 43210' and '+919876543210'
    all find the same person. Returns None for anything unusable rather than
    querying with a junk value.
    """
    number = normalise_phone(phone)
    if not number:
        return None
    return one(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .eq("phone", number)
        .limit(1)
        .execute()
    )


def get_by_email(business_id: str, email: str | None) -> dict | None:
    address = normalise_email(email)
    if not address:
        return None
    return one(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .eq("email", address)
        .limit(1)
        .execute()
    )


def list_customers(business_id: str, limit: int = 100) -> list[dict]:
    return rows(
        db.table("customers")
        .select("*")
        .eq("business_id", business_id)
        .order("last_seen_at", desc=True)
        .limit(limit)
        .execute()
    )


def list_overview(business_id: str, limit: int = 500) -> list[dict]:
    """Every customer plus their calculated status, spend and booking counts."""
    return rows(
        db.table("customer_overview")
        .select("*")
        .eq("business_id", business_id)
        .order("last_seen_at", desc=True)
        .limit(limit)
        .execute()
    )


def get_overview(business_id: str, customer_id: str) -> dict | None:
    return one(
        db.table("customer_overview")
        .select("*")
        .eq("business_id", business_id)
        .eq("id", customer_id)
        .limit(1)
        .execute()
    )


# ------------------------------------------------------------ writes: chat


def upsert_from_chat(
    *,
    business_id: str,
    name: str | None = None,
    phone: str | None = None,
    email: str | None = None,
) -> dict | None:
    """
    Create or update a customer from details captured in a conversation.

    Matches on phone first, then email. Only FILLS BLANKS on an existing
    record: whoever is typing may not be the person that number belongs to.
    Returns None when there is nothing identifying - a name alone is not
    enough to make a customer from chat.
    """
    clean_phone = normalise_phone(phone)
    clean_email = normalise_email(email)
    clean_name = (name or "").strip() or None

    if not clean_phone and not clean_email:
        return None

    existing = get_by_phone(business_id, clean_phone) if clean_phone else None
    if existing is None and clean_email:
        existing = get_by_email(business_id, clean_email)

    if existing is None:
        try:
            created = one(
                _run(
                    db.table("customers").insert(
                        {
                            "business_id": business_id,
                            "name": clean_name,
                            "phone": clean_phone,
                            "email": clean_email,
                            "source": "chat",
                        }
                    )
                )
            )
            if created:
                return created
        except DuplicateCustomer:
            # Two chats gave the same number at the same moment and the other
            # one won. The unique index refused ours, so use theirs.
            pass
        existing = get_by_phone(business_id, clean_phone) or get_by_email(
            business_id, clean_email
        )
        if existing is None:
            return None

    patch: dict = {"last_seen_at": datetime.now(timezone.utc).isoformat()}
    if clean_name and not existing.get("name"):
        patch["name"] = clean_name
    if clean_phone and not existing.get("phone"):
        patch["phone"] = clean_phone
    if clean_email and not existing.get("email"):
        patch["email"] = clean_email

    try:
        _run(
            db.table("customers")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", existing["id"])
        )
    except DuplicateCustomer:
        # The email we tried to fill in belongs to someone else. Keep the
        # record as it was rather than fail the customer's chat.
        patch = {"last_seen_at": patch["last_seen_at"]}
        db.table("customers").update(patch).eq("business_id", business_id).eq(
            "id", existing["id"]
        ).execute()
    return {**existing, **patch}


# ------------------------------------------------------- writes: dashboard


def _clean(fields: dict) -> dict:
    """
    Normalise what the owner typed. An empty string means "clear this field".

    Raises InvalidCustomer for a value we can already tell is wrong, so the
    owner gets "That does not look like a phone number" rather than the raw
    constraint name.
    """
    out: dict = {}
    for key, value in fields.items():
        if key not in EDITABLE:
            continue
        if key == "phone":
            if not value:
                out["phone"] = None
            else:
                phone = normalise_phone(value)
                if phone is None:
                    raise InvalidCustomer("That does not look like a phone number.")
                out["phone"] = phone
        elif key == "email":
            if not value:
                out["email"] = None
            else:
                email = normalise_email(value)
                if email is None:
                    raise InvalidCustomer("That does not look like an email address.")
                out["email"] = email
        elif key == "status_override":
            if value in (None, "", "auto"):
                out[key] = None
            elif value in STATUSES:
                out[key] = value
            else:
                raise InvalidCustomer(f"Unknown status '{value}'.")
        elif key == "preferred_channel":
            if not value:
                out[key] = None
            elif value in CHANNELS:
                out[key] = value
            else:
                raise InvalidCustomer(f"Unknown contact channel '{value}'.")
        elif key == "tags":
            out["tags"] = sorted({str(t).strip() for t in (value or []) if str(t).strip()})
        elif key == "notes":
            out["notes"] = (value or "").strip()
        else:  # name, membership_plan
            out[key] = (value or "").strip() or None
    return out


def create(business_id: str, fields: dict) -> dict:
    """Add a customer from the dashboard. Raises DuplicateCustomer / InvalidCustomer."""
    row = _clean(fields)
    row["business_id"] = business_id
    row["source"] = "dashboard"
    created = one(_run(db.table("customers").insert(row)))
    if created is None:
        raise RuntimeError("Could not create the customer")
    logger.info("Customer %s created from the dashboard", created["id"])
    return created


def update(business_id: str, customer_id: str, fields: dict) -> dict | None:
    """Edit a customer from the dashboard. Returns None if it does not exist."""
    patch = _clean(fields)
    if patch:
        _run(
            db.table("customers")
            .update(patch)
            .eq("business_id", business_id)
            .eq("id", customer_id)
        )
    return get(business_id, customer_id)


def set_marketing_consent(
    *, business_id: str, customer_id: str, consent: str, source: str
) -> dict | None:
    """
    Record whether a customer wants offers.

    There is deliberately NO Python check that chat cannot opt someone in.
    The database refuses it (customers_opt_in_needs_owner), and
    check_customers.py proves that by trying.
    """
    if consent not in CONSENTS:
        raise InvalidCustomer(f"Unknown consent value '{consent}'.")
    _run(
        db.table("customers")
        .update(
            {
                "marketing_consent": consent,
                "consent_source": source,
                "consent_updated_at": datetime.now(timezone.utc).isoformat(),
            }
        )
        .eq("business_id", business_id)
        .eq("id", customer_id)
    )
    return get(business_id, customer_id)
