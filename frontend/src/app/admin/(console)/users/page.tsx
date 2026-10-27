"use client";

import React, { useState } from "react";
import { Users, UserPlus, Ban, RotateCcw, Mail, ShieldCheck, Briefcase, UserCog } from "lucide-react";
import { Avatar, Badge, Button, EmptyState, Input, Modal, PageHeader, SearchInput, Select, StatCard, Toast } from "@/components/ui";
import { mockPlatformUsers, mockTenants } from "@/data";
import type { PlatformUserRecord } from "@/types";
import { formatDate } from "@/lib/utils";
import { platformUserStatusMeta } from "@/lib/status";
import { useToast } from "@/hooks/useToast";

const roleLabels: Record<PlatformUserRecord["role"], string> = {
  platform_admin: "Platform Admin",
  business_owner: "Business Owner",
  staff: "Staff",
};

const roleVariant: Record<PlatformUserRecord["role"], "warning" | "brand" | "neutral"> = {
  platform_admin: "warning",
  business_owner: "brand",
  staff: "neutral",
};

export default function AdminUsersPage() {
  const [users, setUsers] = useState<PlatformUserRecord[]>(mockPlatformUsers);
  const [search, setSearch] = useState("");
  const [role, setRole] = useState("all");
  const [status, setStatus] = useState("all");
  const [business, setBusiness] = useState("all");
  const [inviteOpen, setInviteOpen] = useState(false);
  const [invite, setInvite] = useState({ name: "", email: "", role: "staff" as PlatformUserRecord["role"], businessId: mockTenants[0].id });
  const { toast, showToast, dismissToast } = useToast();

  const filtered = users.filter((u) => {
    const q = search.trim().toLowerCase();
    return (
      (!q || u.name.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || (u.businessName ?? "").toLowerCase().includes(q)) &&
      (role === "all" || u.role === role) &&
      (status === "all" || u.status === status) &&
      (business === "all" || u.businessId === business)
    );
  });

  const setUserStatus = (id: string, s: PlatformUserRecord["status"]) => setUsers((prev) => prev.map((u) => (u.id === id ? { ...u, status: s } : u)));

  const sendInvite = (e: React.FormEvent) => {
    e.preventDefault();
    if (!invite.name.trim() || !invite.email.trim()) return;
    const tenant = mockTenants.find((t) => t.id === invite.businessId);
    setUsers((prev) => [
      {
        id: `usr-${Date.now()}`,
        name: invite.name.trim(),
        email: invite.email.trim(),
        role: invite.role,
        businessId: invite.role === "platform_admin" ? undefined : tenant?.id,
        businessName: invite.role === "platform_admin" ? undefined : tenant?.name,
        status: "invited",
        createdAt: new Date().toISOString(),
      },
      ...prev,
    ]);
    setInviteOpen(false);
    showToast(`Invitation sent to ${invite.email} (simulated).`);
    setInvite((i) => ({ ...i, name: "", email: "" }));
  };

  return (
    <div className="space-y-6">
      <PageHeader
        icon={Users}
        title="Users"
        description="Every account on the platform: admins, business owners and staff."
        actions={
          <Button size="sm" className="text-xs" onClick={() => setInviteOpen(true)}>
            <UserPlus className="w-3.5 h-3.5" /> Invite User
          </Button>
        }
      />

      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <StatCard label="Total Users" value={users.length} icon={Users} tone="indigo" hint="In this sample" />
        <StatCard label="Business Owners" value={users.filter((u) => u.role === "business_owner").length} icon={Briefcase} tone="blue" onClick={() => setRole("business_owner")} active={role === "business_owner"} />
        <StatCard label="Staff" value={users.filter((u) => u.role === "staff").length} icon={UserCog} tone="purple" onClick={() => setRole("staff")} active={role === "staff"} />
        <StatCard label="Platform Admins" value={users.filter((u) => u.role === "platform_admin").length} icon={ShieldCheck} tone="amber" onClick={() => setRole("platform_admin")} active={role === "platform_admin"} />
      </div>

      <div className="flex flex-col xl:flex-row gap-2">
        <SearchInput value={search} onChange={setSearch} placeholder="Search name, email or business..." className="w-full xl:w-72" />
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-2 xl:flex">
          <Select
            aria-label="Filter by role"
            value={role}
            onChange={setRole}
            options={[{ label: "All roles", value: "all" }, ...(Object.keys(roleLabels) as PlatformUserRecord["role"][]).map((r) => ({ label: roleLabels[r], value: r }))]}
            wrapperClassName="xl:w-40"
          />
          <Select
            aria-label="Filter by status"
            value={status}
            onChange={setStatus}
            options={[
              { label: "All statuses", value: "all" },
              { label: "Active", value: "active" },
              { label: "Invited", value: "invited" },
              { label: "Suspended", value: "suspended" },
            ]}
            wrapperClassName="xl:w-36"
          />
          <Select
            aria-label="Filter by business"
            value={business}
            onChange={setBusiness}
            options={[{ label: "All businesses", value: "all" }, ...mockTenants.map((t) => ({ label: t.name, value: t.id }))]}
            wrapperClassName="xl:w-52"
          />
        </div>
      </div>

      {filtered.length === 0 ? (
        <EmptyState icon={Users} title="No users found" description="Try a different search or filter." />
      ) : (
        <div className="rounded-2xl border border-gray-800 bg-gray-900/60 overflow-hidden shadow-lg">
          <ul className="md:hidden divide-y divide-gray-800/80">
            {filtered.map((u) => (
              <li key={u.id} className="p-4 flex items-start gap-3">
                <Avatar name={u.name} size="sm" />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-sm font-semibold text-white truncate">{u.name}</span>
                    <Badge variant={platformUserStatusMeta[u.status].variant}>{platformUserStatusMeta[u.status].label}</Badge>
                  </div>
                  <div className="text-[11px] text-gray-400 font-mono truncate">{u.email}</div>
                  <div className="text-[11px] text-gray-500 mt-0.5">
                    {roleLabels[u.role]}
                    {u.businessName && ` • ${u.businessName}`}
                  </div>
                </div>
              </li>
            ))}
          </ul>
          <div className="hidden md:block overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="border-b border-gray-800 bg-gray-950/80 text-gray-400 uppercase tracking-wider font-semibold">
                <tr>
                  <th className="py-3 px-4">Name</th>
                  <th className="py-3 px-4">Email</th>
                  <th className="py-3 px-4">Role</th>
                  <th className="py-3 px-4">Business</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 hidden lg:table-cell">Last Active</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-800/80 text-gray-200">
                {filtered.map((u) => (
                  <tr key={u.id} className="hover:bg-gray-800/40 transition-colors">
                    <td className="py-3 px-4">
                      <div className="flex items-center gap-2.5">
                        <Avatar name={u.name} size="sm" />
                        <span className="font-semibold text-white whitespace-nowrap">{u.name}</span>
                      </div>
                    </td>
                    <td className="py-3 px-4 font-mono text-gray-300">{u.email}</td>
                    <td className="py-3 px-4">
                      <Badge variant={roleVariant[u.role]}>{roleLabels[u.role]}</Badge>
                    </td>
                    <td className="py-3 px-4 text-gray-300 max-w-[12rem] truncate">{u.businessName ?? <span className="text-gray-500">Platform</span>}</td>
                    <td className="py-3 px-4">
                      <Badge variant={platformUserStatusMeta[u.status].variant}>{platformUserStatusMeta[u.status].label}</Badge>
                    </td>
                    <td className="py-3 px-4 hidden lg:table-cell text-gray-400 font-mono whitespace-nowrap">
                      {u.lastActiveAt ? formatDate(u.lastActiveAt, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false }) : "Never"}
                    </td>
                    <td className="py-3 px-4 text-right">
                      <div className="flex justify-end gap-1">
                        {u.status === "invited" && (
                          <Button variant="ghost" size="sm" onClick={() => showToast(`Invitation re-sent to ${u.email}.`, "info")} aria-label={`Resend invite to ${u.name}`}>
                            <Mail className="w-3.5 h-3.5" />
                          </Button>
                        )}
                        {u.id !== "usr-admin-1" &&
                          (u.status === "suspended" ? (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setUserStatus(u.id, "active");
                                showToast(`${u.name} reactivated.`);
                              }}
                              aria-label={`Reactivate ${u.name}`}
                            >
                              <RotateCcw className="w-3.5 h-3.5 text-emerald-400" />
                            </Button>
                          ) : (
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => {
                                setUserStatus(u.id, "suspended");
                                showToast(`${u.name} suspended.`, "info");
                              }}
                              aria-label={`Suspend ${u.name}`}
                              className="hover:text-rose-300"
                            >
                              <Ban className="w-3.5 h-3.5" />
                            </Button>
                          ))}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <Modal isOpen={inviteOpen} onClose={() => setInviteOpen(false)} title="Invite User" description="They'll receive an email to set a password." maxWidth="md">
        <form onSubmit={sendInvite} className="space-y-4">
          <Input label="Full Name" value={invite.name} onChange={(e) => setInvite((i) => ({ ...i, name: e.target.value }))} required />
          <Input label="Email" type="email" value={invite.email} onChange={(e) => setInvite((i) => ({ ...i, email: e.target.value }))} required />
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <Select
              label="Role"
              value={invite.role}
              onChange={(r) => setInvite((i) => ({ ...i, role: r as PlatformUserRecord["role"] }))}
              options={(Object.keys(roleLabels) as PlatformUserRecord["role"][]).map((r) => ({ label: roleLabels[r], value: r }))}
            />
            {invite.role !== "platform_admin" && (
              <Select
                label="Business"
                value={invite.businessId}
                onChange={(b) => setInvite((i) => ({ ...i, businessId: b }))}
                options={mockTenants.map((t) => ({ label: t.name, value: t.id }))}
              />
            )}
          </div>
          <div className="flex justify-end gap-2 pt-4 border-t border-gray-800">
            <Button type="button" variant="outline" size="sm" onClick={() => setInviteOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm">
              Send Invite
            </Button>
          </div>
        </form>
      </Modal>
      <Toast toast={toast} onDismiss={dismissToast} />
    </div>
  );
}
