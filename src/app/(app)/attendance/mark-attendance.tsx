"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { buttonClass } from "@/components/ui";
import { queue, type QueuedPunch } from "./offline-queue";

type Status = { tone: "info" | "ok" | "warn" | "error"; text: string } | null;

function getPosition(): Promise<GeolocationPosition | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, () => resolve(null), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    }),
  );
}

/** Downscale a camera photo to ≤ 640 px JPEG so it stays well under the 2 MB bucket limit. */
async function compress(file: File): Promise<Blob> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, 640 / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  canvas.getContext("2d")!.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  return new Promise((resolve) => canvas.toBlob((b) => resolve(b!), "image/jpeg", 0.8));
}

/** Sends one punch. Throws TypeError on network failure so the caller can queue it. */
async function send(p: QueuedPunch, offline: boolean) {
  const supabase = createClient();
  let selfie_path: string | null = null;
  if (p.selfie) {
    const path = `${p.employee_id}/${p.punch_time.slice(0, 10)}/${p.client_event_id}.jpg`;
    const { error } = await supabase.storage
      .from("attendance-selfies")
      .upload(path, p.selfie, { contentType: "image/jpeg", upsert: true });
    if (error && !error.message.includes("exists")) throw new Error(`Selfie upload failed: ${error.message}`);
    selfie_path = path;
  }
  const { data, error } = await supabase
    .from("attendance_punches")
    .insert({
      employee_id: p.employee_id,
      punch_type: p.punch_type,
      source: window.matchMedia("(pointer: coarse)").matches ? "mobile" : "web",
      latitude: p.latitude,
      longitude: p.longitude,
      accuracy_m: p.accuracy_m,
      selfie_path,
      client_event_id: p.client_event_id,
      captured_offline: offline,
      ...(offline ? { punch_time: p.punch_time } : {}),
    })
    .select("verification, within_geofence, distance_m")
    .single();
  if (error) {
    if (error.code === "23505") return null; // already synced (idempotent retry)
    if (error.message.includes("Failed to fetch")) throw new TypeError(error.message);
    throw new Error(error.message);
  }
  return data;
}

export function MarkAttendance({
  employeeId,
  nextType,
  locationHasGeofence,
}: {
  employeeId: string;
  nextType: "in" | "out";
  locationHasGeofence: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState(0);
  const selfieRef = useRef<HTMLInputElement>(null);

  const syncQueue = useCallback(async () => {
    let items: QueuedPunch[] = [];
    try {
      items = await queue.all();
    } catch {
      return;
    }
    setPending(items.length);
    if (!items.length || !navigator.onLine) return;
    let synced = 0;
    for (const item of items.sort((a, b) => a.punch_time.localeCompare(b.punch_time))) {
      try {
        await send(item, true);
        await queue.remove(item.client_event_id);
        synced++;
      } catch (e) {
        if (e instanceof TypeError) break; // still offline
        await queue.remove(item.client_event_id); // rejected by server rules — don't retry forever
        setStatus({ tone: "error", text: `An offline punch was rejected: ${(e as Error).message}` });
      }
    }
    setPending((await queue.all()).length);
    if (synced) {
      setStatus({ tone: "ok", text: `${synced} offline punch(es) synced — your manager will verify them.` });
      router.refresh();
    }
  }, [router]);

  useEffect(() => {
    if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js").catch(() => {});
    const initial = setTimeout(syncQueue, 0); // flush anything captured offline earlier
    window.addEventListener("online", syncQueue);
    return () => {
      clearTimeout(initial);
      window.removeEventListener("online", syncQueue);
    };
  }, [syncQueue]);

  async function mark() {
    setBusy(true);
    setStatus({ tone: "info", text: "Getting your location…" });
    const pos = await getPosition();
    const file = selfieRef.current?.files?.[0];
    const punch: QueuedPunch = {
      client_event_id: crypto.randomUUID(),
      employee_id: employeeId,
      punch_type: nextType,
      punch_time: new Date().toISOString(),
      latitude: pos ? Number(pos.coords.latitude.toFixed(6)) : null,
      longitude: pos ? Number(pos.coords.longitude.toFixed(6)) : null,
      accuracy_m: pos ? Math.round(pos.coords.accuracy) : null,
      selfie: file ? await compress(file) : null,
    };

    try {
      if (!navigator.onLine) throw new TypeError("offline");
      setStatus({ tone: "info", text: "Saving…" });
      const result = await send(punch, false);
      if (selfieRef.current) selfieRef.current.value = "";
      const label = nextType === "in" ? "Checked in" : "Checked out";
      if (result?.verification === "auto") {
        setStatus({ tone: "ok", text: `${label} at the office.` });
      } else {
        const where = result?.distance_m != null ? `${Math.round(Number(result.distance_m))} m from your office` : "without a GPS fix";
        setStatus({ tone: "warn", text: `${label} ${where} — your manager will verify this field attendance.` });
      }
      router.refresh();
    } catch (e) {
      if (e instanceof TypeError) {
        await queue.add(punch);
        setPending((await queue.all()).length);
        setStatus({ tone: "warn", text: "You're offline. Saved on this device — it will sync automatically when you reconnect." });
      } else {
        setStatus({ tone: "error", text: (e as Error).message });
      }
    } finally {
      setBusy(false);
    }
  }

  const tones = {
    info: "bg-gray-50 text-gray-700",
    ok: "bg-emerald-50 text-emerald-800",
    warn: "bg-amber-50 text-amber-900",
    error: "bg-red-50 text-red-700",
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={mark}
          disabled={busy}
          className={`${buttonClass(nextType === "in" ? "success" : "primary")} px-6 py-3 text-base`}
        >
          {busy ? "Working…" : nextType === "in" ? "Check in" : "Check out"}
        </button>
        <label className="text-sm text-gray-600">
          <span className="mr-2">Selfie (optional):</span>
          <input ref={selfieRef} type="file" accept="image/*" capture="user" className="text-xs" />
        </label>
      </div>
      {!locationHasGeofence && (
        <p className="text-xs text-amber-700">
          Your office has no GPS coordinates yet, so every web/mobile punch needs manager verification. HR can add them under
          Organization → Locations.
        </p>
      )}
      {status && <p className={`rounded-lg px-3 py-2 text-sm ${tones[status.tone]}`}>{status.text}</p>}
      {pending > 0 && (
        <p className="text-xs text-amber-700">
          {pending} punch(es) waiting to sync from this device.{" "}
          <button type="button" onClick={syncQueue} className="underline">
            Retry now
          </button>
        </p>
      )}
    </div>
  );
}
