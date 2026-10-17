"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Select } from "@/components/ui";
import { saveSubscription } from "./actions";

export function SubscriptionForm({ report, frequency }: { report: string; frequency: string | null }) {
  return (
    <ActionForm action={saveSubscription}>
      <input type="hidden" name="report" value={report} />
      <label htmlFor="frequency" className="mb-1 block text-xs font-medium text-gray-700">
        Send me this summary
      </label>
      <div className="flex gap-2">
        <Select id="frequency" name="frequency" defaultValue={frequency ?? "off"} key={frequency ?? "off"} className="max-w-40">
          <option value="off">Never</option>
          <option value="daily">Daily</option>
          <option value="weekly">Weekly (Mon)</option>
          <option value="monthly">Monthly (1st)</option>
        </Select>
        <SubmitButton variant="secondary">Save</SubmitButton>
      </div>
    </ActionForm>
  );
}
