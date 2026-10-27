"""Request and response shapes."""

from datetime import date

from pydantic import BaseModel, Field


class StartSessionRequest(BaseModel):
    chat_slug: str = Field(min_length=1, max_length=120)


class ChatMessageRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)


class OwnerReply(BaseModel):
    body: str = Field(min_length=1, max_length=2000)


class ResolveConversation(BaseModel):
    resolved: bool = True


class ArticleInput(BaseModel):
    title: str = Field(min_length=3, max_length=300)
    body: str = Field(min_length=3, max_length=8000)
    tags: list[str] = Field(default_factory=list)
    is_active: bool = True


class ChatSettingsInput(BaseModel):
    chat_greeting: str | None = Field(default=None, max_length=500)
    chat_enabled: bool | None = None
    agent_persona: str | None = Field(default=None, max_length=4000)


class BookingDecision(BaseModel):
    decision: str = Field(description="'approve' or 'reject'")
    note: str = Field(default="", max_length=1000, description="Shown to the customer.")
    decided_by: str = Field(default="owner", max_length=120)


class BookingStatusChange(BaseModel):
    status: str = Field(description="pending | confirmed | cancelled | completed")
    note: str = Field(default="", max_length=1000)


class CustomerInput(BaseModel):
    """A customer the owner adds from the dashboard."""

    name: str = Field(default="", max_length=120)
    phone: str = Field(default="", max_length=40)
    email: str = Field(default="", max_length=200)
    status: str = Field(default="auto", description="auto | lead | active | inactive")
    membership_plan: str = Field(default="", max_length=120)
    preferred_channel: str = Field(default="", description="'' | sms | whatsapp | email")
    notes: str = Field(default="", max_length=4000)
    tags: list[str] = Field(default_factory=list)


class CustomerPatch(BaseModel):
    """
    A partial edit. A field left out (None) is not touched; an empty string
    clears it.
    """

    name: str | None = Field(default=None, max_length=120)
    phone: str | None = Field(default=None, max_length=40)
    email: str | None = Field(default=None, max_length=200)
    status: str | None = Field(default=None, description="auto | lead | active | inactive")
    membership_plan: str | None = Field(default=None, max_length=120)
    preferred_channel: str | None = None
    notes: str | None = Field(default=None, max_length=4000)
    tags: list[str] | None = None
    marketing_consent: str | None = Field(
        default=None,
        description="unknown | opted_in | opted_out. Only the owner can set opted_in.",
    )


class InvoiceItemInput(BaseModel):
    """One line on an invoice. The database multiplies and adds - never send a total."""

    description: str = Field(min_length=1, max_length=200)
    quantity: int = Field(default=1, ge=1, le=1000)
    unit_price: float = Field(ge=0, le=10_000_000)


class InvoiceCreate(BaseModel):
    customer_id: str
    # Bill a booking: leave items empty and its own snapshot price is used.
    appointment_id: str | None = None
    items: list[InvoiceItemInput] = Field(default_factory=list, max_length=50)
    # Empty means "today + the business's due_days setting".
    due_date: date | None = None
    notes: str = Field(default="", max_length=1000)
    send_to_chat: bool = True


class InvoicePaid(BaseModel):
    method: str = Field(description="upi | cash | card | bank_transfer")
    reference: str = Field(default="", max_length=60, description="UPI reference, cheque number...")
    send_receipt: bool = True


class InvoiceCancel(BaseModel):
    reason: str = Field(default="", max_length=300)
    notify: bool = True


class InvoiceRefund(BaseModel):
    note: str = Field(default="", max_length=300)


class PaymentSettingsPatch(BaseModel):
    upi_id: str | None = Field(default=None, max_length=320)
    payee_name: str | None = Field(default=None, max_length=120)
    invoice_prefix: str | None = Field(default=None, max_length=10)
    due_days: int | None = Field(default=None, ge=0, le=90)


class PaymentClaim(BaseModel):
    """The customer, on the public pay page: 'I have paid'."""

    reference: str = Field(default="", max_length=60)


# ------------------------------------------------------------------ inventory


class InventoryItemInput(BaseModel):
    name: str = Field(min_length=1, max_length=160)
    sku: str = Field(default="", max_length=60)
    description: str = Field(default="", max_length=1000)
    category: str = Field(default="", max_length=80)
    unit: str = Field(default="piece", max_length=20)
    quantity: int = Field(default=0, ge=0, le=1_000_000, description="Opening stock.")
    reorder_level: int = Field(default=0, ge=0, le=1_000_000)
    cost_price: float = Field(default=0, ge=0, le=10_000_000)
    sale_price: float = Field(default=0, ge=0, le=10_000_000)


class InventoryItemPatch(BaseModel):
    """Details only. Quantity is changed through /adjust, never here."""

    name: str | None = Field(default=None, min_length=1, max_length=160)
    sku: str | None = Field(default=None, max_length=60)
    description: str | None = Field(default=None, max_length=1000)
    category: str | None = Field(default=None, max_length=80)
    unit: str | None = Field(default=None, max_length=20)
    reorder_level: int | None = Field(default=None, ge=0, le=1_000_000)
    cost_price: float | None = Field(default=None, ge=0, le=10_000_000)
    sale_price: float | None = Field(default=None, ge=0, le=10_000_000)
    is_active: bool | None = None


class CampaignInput(BaseModel):
    name: str = Field(min_length=1, max_length=120)
    body: str = Field(min_length=3, max_length=2000)
    audience: str = Field(default="custom")
    # Only used when audience == "custom".
    customer_ids: list[str] = Field(default_factory=list, max_length=500)


class CampaignPatch(BaseModel):
    name: str | None = Field(default=None, min_length=1, max_length=120)
    body: str | None = Field(default=None, min_length=3, max_length=2000)
    audience: str | None = None
    customer_ids: list[str] | None = Field(default=None, max_length=500)


class CampaignApproval(BaseModel):
    approved_by: str = Field(default="owner", max_length=120)


class CampaignDraftRequest(BaseModel):
    """Ask the model for wording. It writes text; it creates nothing."""

    intent: str = Field(min_length=3, max_length=500)
    audience: str = Field(default="all")


class DocumentInput(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str = Field(default="other")
    description: str = Field(default="", max_length=1000)
    content: str = Field(default="", max_length=100_000, description="The searchable text.")
    # FALSE by default on purpose: a document is private until the owner says
    # otherwise, so nothing becomes quotable by the assistant unintentionally.
    is_public: bool = False


class DocumentPatch(BaseModel):
    title: str | None = Field(default=None, min_length=1, max_length=200)
    category: str | None = None
    description: str | None = Field(default=None, max_length=1000)
    content: str | None = Field(default=None, max_length=100_000)
    is_public: bool | None = None
    is_active: bool | None = None


class StockAdjustment(BaseModel):
    delta: int = Field(description="Negative removes stock, positive adds it. Never 0.")
    reason: str = Field(default="adjustment")
    note: str = Field(default="", max_length=300)
    # Send the same key twice and the stock moves once. The browser generates
    # one per click, so a double tap or a retry is harmless.
    idempotency_key: str | None = Field(default=None, max_length=80)
