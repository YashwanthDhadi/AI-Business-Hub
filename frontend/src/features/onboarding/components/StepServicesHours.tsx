import React, { useState } from "react";
import { Button, Input } from "@/components/ui";
import { OnboardingState } from "../types";
import { Clock, Plus, Trash2, ArrowRight, ArrowLeft } from "lucide-react";
import { ServiceItem } from "@/types";

interface StepServicesHoursProps {
  data: OnboardingState;
  onChange: (updates: Partial<OnboardingState>) => void;
  onNext: () => void;
  onBack: () => void;
}

export function StepServicesHours({
  data,
  onChange,
  onNext,
  onBack,
}: StepServicesHoursProps) {
  const [newServiceName, setNewServiceName] = useState("");
  const [newServicePrice, setNewServicePrice] = useState("");
  const [newServiceDuration, setNewServiceDuration] = useState("60");

  const handleAddService = () => {
    if (!newServiceName || !newServicePrice) return;

    const newService: ServiceItem = {
      id: `srv-${Date.now()}`,
      name: newServiceName,
      description: "Standard service",
      price: parseFloat(newServicePrice) || 0,
      durationMinutes: parseInt(newServiceDuration, 10) || 60,
    };

    onChange({
      services: [...data.services, newService],
    });

    setNewServiceName("");
    setNewServicePrice("");
    setNewServiceDuration("60");
  };

  const handleRemoveService = (id: string) => {
    onChange({
      services: data.services.filter((s) => s.id !== id),
    });
  };

  return (
    <div className="space-y-6">
      <div className="border-b border-gray-800 pb-4">
        <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
          <Clock className="w-5 h-5 text-indigo-400" />
          Working Hours & Services
        </h2>
        <p className="text-xs text-gray-400 mt-1">
          Your AI assistant will reference these hours and services when answering inquiries and scheduling appointments.
        </p>
      </div>

      {/* Operating Hours Summary */}
      <div className="space-y-1.5">
        <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
          Standard Operating Hours Summary
        </label>
        <Input
          placeholder="e.g. Mon-Fri: 6:00 AM - 10:00 PM | Sat: 7:00 AM - 8:00 PM | Sun: 8:00 AM - 6:00 PM"
          value={data.workingHoursSummary}
          onChange={(e) => onChange({ workingHoursSummary: e.target.value })}
          required
        />
        <p className="text-[11px] text-gray-500">
          You can configure detailed day-by-day shifts later in Business Settings.
        </p>
      </div>

      {/* Services Catalog */}
      <div className="space-y-3">
        <label className="block text-xs font-medium text-gray-300 uppercase tracking-wider">
          Core Services & Pricing
        </label>

        {/* Existing Services List */}
        <div className="space-y-2 max-h-56 overflow-y-auto pr-1">
          {data.services.length === 0 ? (
            <div className="p-4 rounded-lg border border-dashed border-gray-800 text-center text-xs text-gray-500">
              No services added yet. Add at least one service below.
            </div>
          ) : (
            data.services.map((srv) => (
              <div
                key={srv.id}
                className="flex items-center justify-between p-3 rounded-lg border border-gray-800 bg-gray-900/60"
              >
                <div>
                  <h4 className="text-sm font-semibold text-white">{srv.name}</h4>
                  <p className="text-xs text-gray-400 mt-0.5">
                    {srv.durationMinutes} min • ${srv.price}
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveService(srv.id)}
                  className="text-gray-500 hover:text-rose-400 p-1.5 rounded transition-colors cursor-pointer"
                  aria-label="Remove service"
                >
                  <Trash2 className="w-4 h-4" />
                </button>
              </div>
            ))
          )}
        </div>

        {/* Quick Add Service Sub-Form */}
        <div className="p-3.5 rounded-lg border border-gray-800/80 bg-gray-950/70 space-y-3">
          <span className="text-xs font-medium text-gray-400 block">
            Add a Service:
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Service Name (e.g. HIIT Class)"
              value={newServiceName}
              onChange={(e) => setNewServiceName(e.target.value)}
              className="rounded-lg bg-gray-900 border border-gray-800 px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500 sm:col-span-1"
            />
            <input
              type="number"
              placeholder="Price ($)"
              value={newServicePrice}
              onChange={(e) => setNewServicePrice(e.target.value)}
              className="rounded-lg bg-gray-900 border border-gray-800 px-3 py-1.5 text-xs text-white placeholder-gray-500 focus:outline-none focus:border-indigo-500"
            />
            <div className="flex gap-2">
              <select
                value={newServiceDuration}
                onChange={(e) => setNewServiceDuration(e.target.value)}
                className="rounded-lg bg-gray-900 border border-gray-800 px-2 py-1.5 text-xs text-gray-200 focus:outline-none focus:border-indigo-500 flex-1"
              >
                <option value="30">30 min</option>
                <option value="45">45 min</option>
                <option value="60">60 min</option>
                <option value="90">90 min</option>
              </select>
              <Button
                type="button"
                variant="secondary"
                size="sm"
                onClick={handleAddService}
                disabled={!newServiceName || !newServicePrice}
              >
                <Plus className="w-3.5 h-3.5" />
                Add
              </Button>
            </div>
          </div>
        </div>
      </div>

      <div className="flex items-center justify-between pt-4 border-t border-gray-800">
        <Button type="button" variant="outline" size="md" onClick={onBack}>
          <ArrowLeft className="w-4 h-4 mr-1" />
          Back
        </Button>
        <Button
          type="button"
          variant="primary"
          size="md"
          disabled={data.services.length === 0}
          onClick={onNext}
        >
          Continue to AI Capabilities
          <ArrowRight className="w-4 h-4 ml-1" />
        </Button>
      </div>
    </div>
  );
}
