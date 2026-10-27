"use client";

import React, { useState } from "react";
import { Modal, Button, Input, Select, Textarea } from "@/components/ui";
import type { ContactChannel, Customer } from "@/types";
import type { NewCustomer } from "@/lib/api/dashboard";

interface AddCustomerModalProps {
  isOpen: boolean;
  onClose: () => void;
  /** Rejects with the backend's message (e.g. a duplicate phone), shown in the form. */
  onAdd: (customer: NewCustomer) => Promise<void>;
}

type StatusChoice = "auto" | Customer["status"];

export function AddCustomerModal({ isOpen, onClose, onAdd }: AddCustomerModalProps) {
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [status, setStatus] = useState<StatusChoice>("auto");
  const [channel, setChannel] = useState<ContactChannel | "">("");
  const [notes, setNotes] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => {
    setName("");
    setEmail("");
    setPhone("");
    setStatus("auto");
    setChannel("");
    setNotes("");
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await onAdd({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim(),
        status,
        preferred_channel: channel,
        notes: notes.trim(),
      });
      reset();
      onClose();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save the customer.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal isOpen={isOpen} onClose={handleClose} title="Add Customer" description="Create a new customer profile." maxWidth="md">
      <form onSubmit={(e) => void handleSubmit(e)} className="space-y-4 pt-1">
        <Input label="Full Name" placeholder="e.g. Rahul Sharma" value={name} onChange={(e) => setName(e.target.value)} required />
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Input label="Phone" placeholder="98765 43210" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <Input label="Email" type="email" placeholder="name@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <Select
            label="Status"
            value={status}
            onChange={(v) => setStatus(v as StatusChoice)}
            options={[
              { label: "Automatic (from bookings)", value: "auto" },
              { label: "Active member", value: "active" },
              { label: "Lead (not yet a member)", value: "lead" },
              { label: "Inactive", value: "inactive" },
            ]}
          />
          <Select
            label="Preferred Contact"
            value={channel}
            onChange={(v) => setChannel(v as ContactChannel | "")}
            options={[
              { label: "No preference", value: "" },
              { label: "WhatsApp", value: "whatsapp" },
              { label: "SMS", value: "sms" },
              { label: "Email", value: "email" },
            ]}
          />
        </div>
        <Textarea label="Notes" rows={3} placeholder="Goals, preferences, anything to remember..." value={notes} onChange={(e) => setNotes(e.target.value)} />
        {error && (
          <p role="alert" className="text-xs text-rose-400">
            {error}
          </p>
        )}
        <div className="flex items-center justify-end gap-2 pt-4 border-t border-gray-800">
          <Button type="button" variant="outline" size="sm" onClick={handleClose} disabled={saving}>
            Cancel
          </Button>
          <Button type="submit" size="sm" disabled={saving}>
            {saving ? "Saving…" : "Save Customer"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
