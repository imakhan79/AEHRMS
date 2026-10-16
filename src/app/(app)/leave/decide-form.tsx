"use client";

import { ActionForm, SubmitButton } from "@/components/form";
import { Input } from "@/components/ui";
import { decideLeave } from "./actions";

export function DecideForm({ id }: { id: string }) {
  return (
    <ActionForm action={decideLeave.bind(null, id)} className="flex flex-wrap items-center gap-2">
      <Input name="comment" placeholder="Comment (required to reject)" className="w-56 py-1.5 text-xs" maxLength={500} />
      <SubmitButton size="sm" variant="success" name="decision" value="approved">
        Approve
      </SubmitButton>
      <SubmitButton size="sm" variant="danger" name="decision" value="rejected">
        Reject
      </SubmitButton>
    </ActionForm>
  );
}
