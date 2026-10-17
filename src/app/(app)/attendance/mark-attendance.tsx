"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AnimatePresence, motion } from "framer-motion";
import { createClient } from "@/lib/supabase/client";
import { buttonClass, cn } from "@/components/ui";
import { EASE_OUT } from "@/components/motion";
import { queue, type QueuedPunch } from "./offline-queue";

type Status = { tone: "info" | "ok" | "warn" | "error"; text: string } | null;
type Fix = { lat: number; lng: number; accuracy: number };
type GpsState = { state: "idle" | "locating" | "ok" | "denied" | "unavailable"; fix?: Fix };

export interface Office {
  name: string;
  latitude: number | null;
  longitude: number | null;
  radius: number;
}

function getPosition(): Promise<GeolocationPosition | "denied" | null> {
  if (!("geolocation" in navigator)) return Promise.resolve(null);
  return new Promise((resolve) =>
    navigator.geolocation.getCurrentPosition(resolve, (e) => resolve(e.code === e.PERMISSION_DENIED ? "denied" : null), {
      enableHighAccuracy: true,
      timeout: 15000,
      maximumAge: 0,
    }),
  );
}

/** Haversine distance in metres (same formula as private.distance_m in the database). */
function distanceM(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Downscale a photo to ≤ 640 px JPEG so it stays well under the 2 MB bucket limit. */
async function compress(source: Blob): Promise<Blob> {
  const bitmap = await createImageBitmap(source);
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
    const { error } = await supabase.storage.from("attendance-selfies").upload(path, p.selfie, { contentType: "image/jpeg", upsert: true });
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

const timeFmt = new Intl.DateTimeFormat("en-PK", { hour: "2-digit", minute: "2-digit", second: "2-digit", timeZone: "Asia/Karachi" });
const shortTime = new Intl.DateTimeFormat("en-PK", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Karachi" });
function duration(ms: number) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
}

/** Front-camera capture with live preview; falls back to the file picker when the camera isn't available. */
function SelfieCapture({ value, onChange }: { value: Blob | null; onChange: (b: Blob | null) => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const stream = useRef<MediaStream | null>(null);
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stop = useCallback(() => {
    stream.current?.getTracks().forEach((t) => t.stop());
    stream.current = null;
    setOpen(false);
  }, []);
  useEffect(() => stop, [stop]);
  const preview = useMemo(() => (value ? URL.createObjectURL(value) : null), [value]);
  useEffect(() => () => void (preview && URL.revokeObjectURL(preview)), [preview]);

  async function start() {
    setErr(null);
    if (!navigator.mediaDevices?.getUserMedia) return file.current?.click();
    try {
      stream.current = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 640 } }, audio: false });
      setOpen(true);
      requestAnimationFrame(() => {
        if (video.current) {
          video.current.srcObject = stream.current;
          void video.current.play();
        }
      });
    } catch {
      setErr("Camera blocked — choose a photo instead.");
      file.current?.click();
    }
  }

  function snap() {
    const v = video.current;
    if (!v) return;
    const c = document.createElement("canvas");
    c.width = v.videoWidth;
    c.height = v.videoHeight;
    const ctx = c.getContext("2d")!;
    ctx.translate(c.width, 0); // un-mirror the preview
    ctx.scale(-1, 1);
    ctx.drawImage(v, 0, 0);
    c.toBlob((b) => b && onChange(b), "image/jpeg", 0.85);
    stop();
  }

  return (
    <div>
      <input ref={file} type="file" accept="image/*" capture="user" className="sr-only" tabIndex={-1} onChange={(e) => onChange(e.target.files?.[0] ?? null)} />
      {open ? (
        <div className="space-y-2">
          <video ref={video} playsInline muted className="aspect-[4/3] w-full max-w-60 -scale-x-100 rounded-2xl bg-gray-900 object-cover" />
          <div className="flex gap-2">
            <button type="button" onClick={snap} className={buttonClass("primary", "sm")}>
              Take photo
            </button>
            <button type="button" onClick={stop} className={buttonClass("secondary", "sm")}>
              Cancel
            </button>
          </div>
        </div>
      ) : preview ? (
        <div className="flex items-center gap-3">
          {/* eslint-disable-next-line @next/next/no-img-element -- local object URL preview */}
          <img src={preview} alt="Your selfie" className="h-14 w-14 rounded-xl object-cover ring-2 ring-white shadow" />
          <div className="flex flex-col items-start gap-1 text-xs">
            <span className="font-medium text-emerald-700">Selfie attached</span>
            <button type="button" onClick={() => onChange(null)} className="text-gray-500 underline">
              Remove
            </button>
          </div>
        </div>
      ) : (
        <button type="button" onClick={start} className="inline-flex items-center gap-2 rounded-xl px-3 py-2 text-xs font-semibold text-gray-700 ring-1 ring-inset ring-gray-200 transition-colors hover:bg-gray-50">
          <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4 text-gray-500" aria-hidden="true">
            <path fillRule="evenodd" d="M1 8a2 2 0 0 1 2-2h.93a2 2 0 0 0 1.664-.89l.812-1.22A2 2 0 0 1 8.07 3h3.86a2 2 0 0 1 1.664.89l.812 1.22A2 2 0 0 0 16.07 6H17a2 2 0 0 1 2 2v7a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8Zm13.5 3a4.5 4.5 0 1 1-9 0 4.5 4.5 0 0 1 9 0ZM10 14a3 3 0 1 0 0-6 3 3 0 0 0 0 6Z" clipRule="evenodd" />
          </svg>
          Add selfie <span className="font-normal text-gray-400">(optional)</span>
        </button>
      )}
      {err && <p className="mt-1 text-xs text-amber-700">{err}</p>}
    </div>
  );
}

export function MarkAttendance({
  employeeId,
  nextType,
  office,
  firstIn,
  lastOut,
}: {
  employeeId: string;
  nextType: "in" | "out";
  office: Office | null;
  firstIn: string | null;
  lastOut: string | null;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<Status>(null);
  const [pending, setPending] = useState(0);
  const [selfie, setSelfie] = useState<Blob | null>(null);
  const [now, setNow] = useState<Date | null>(null);
  const [gps, setGps] = useState<GpsState>({ state: "idle" });
  const geofenced = office?.latitude != null && office.longitude != null;

  useEffect(() => {
    const tick = () => setNow(new Date());
    const first = setTimeout(tick, 0);
    const id = setInterval(tick, 1000);
    return () => {
      clearTimeout(first);
      clearInterval(id);
    };
  }, []);

  const locate = useCallback(async () => {
    setGps({ state: "locating" });
    const pos = await getPosition();
    if (pos === "denied") return setGps({ state: "denied" }), null;
    if (!pos) return setGps({ state: "unavailable" }), null;
    const fix = { lat: pos.coords.latitude, lng: pos.coords.longitude, accuracy: Math.round(pos.coords.accuracy) };
    setGps({ state: "ok", fix });
    return fix;
  }, []);

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
    const fix = await locate();
    const punch: QueuedPunch = {
      client_event_id: crypto.randomUUID(),
      employee_id: employeeId,
      punch_type: nextType,
      punch_time: new Date().toISOString(),
      latitude: fix ? Number(fix.lat.toFixed(6)) : null,
      longitude: fix ? Number(fix.lng.toFixed(6)) : null,
      accuracy_m: fix?.accuracy ?? null,
      selfie: selfie ? await compress(selfie) : null,
    };

    try {
      if (!navigator.onLine) throw new TypeError("offline");
      setStatus({ tone: "info", text: "Saving…" });
      const result = await send(punch, false);
      setSelfie(null);
      const label = nextType === "in" ? "Checked in" : "Checked out";
      if (result?.verification === "auto") {
        setStatus({ tone: "ok", text: `${label} at ${office?.name ?? "the office"}. Verified automatically.` });
      } else {
        const where = result?.distance_m != null ? `${Math.round(Number(result.distance_m))} m from ${office?.name ?? "your office"}` : "without a GPS fix";
        setStatus({ tone: "warn", text: `${label} ${where}. Your manager will verify this field attendance.` });
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
    info: "bg-gray-50 text-gray-700 ring-gray-200",
    ok: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    warn: "bg-amber-50 text-amber-900 ring-amber-200",
    error: "bg-red-50 text-red-700 ring-red-200",
  };

  const working = !!firstIn && nextType === "out";
  const worked = firstIn && now ? (lastOut && !working ? Date.parse(lastOut) : now.getTime()) - Date.parse(firstIn) : 0;
  const dist = geofenced && gps.fix ? distanceM(gps.fix, { lat: office!.latitude!, lng: office!.longitude! }) : null;
  const inside = dist != null && dist <= office!.radius;

  const gpsChip = (() => {
    if (!geofenced) return { tone: "amber", text: `${office?.name ?? "Your office"} has no geofence yet — punches go to your manager.` };
    switch (gps.state) {
      case "idle":
        return { tone: "gray", text: "Location is checked when you punch." };
      case "locating":
        return { tone: "gray", text: "Finding your location…" };
      case "denied":
        return { tone: "red", text: "Location blocked — allow it in your browser, or your manager verifies the punch." };
      case "unavailable":
        return { tone: "amber", text: "No GPS fix — your manager will verify the punch." };
      default:
        return inside
          ? { tone: "green", text: `At ${office!.name} · ${Math.round(dist!)} m away (±${gps.fix!.accuracy} m)` }
          : { tone: "amber", text: `${Math.round(dist!).toLocaleString("en-PK")} m from ${office!.name} — counts as field attendance.` };
    }
  })();
  const chipTone: Record<string, string> = {
    gray: "bg-gray-50 text-gray-600 ring-gray-200",
    green: "bg-emerald-50 text-emerald-800 ring-emerald-200",
    amber: "bg-amber-50 text-amber-900 ring-amber-200",
    red: "bg-red-50 text-red-700 ring-red-200",
  };

  return (
    <div className="space-y-5">
      <div className="grid gap-5 sm:grid-cols-[1fr_auto] sm:items-center">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-[0.08em] text-gray-500">Pakistan time</div>
          <div className="mt-1 text-4xl font-bold tabular-nums tracking-tight text-gray-900 sm:text-5xl" suppressHydrationWarning>
            {now ? timeFmt.format(now) : "--:--:--"}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-sm">
            <span
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset",
                working ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : firstIn ? "bg-gray-100 text-gray-700 ring-gray-200" : "bg-amber-50 text-amber-900 ring-amber-200",
              )}
            >
              <span className={cn("h-1.5 w-1.5 rounded-full", working ? "animate-pulse bg-emerald-500" : firstIn ? "bg-gray-400" : "bg-amber-500")} />
              {working ? `Working since ${shortTime.format(new Date(firstIn!))}` : firstIn ? "Checked out" : "Not checked in yet"}
            </span>
            {firstIn && (
              <span className="text-gray-600" suppressHydrationWarning>
                Worked <strong className="tabular-nums text-gray-900">{duration(worked)}</strong> today
              </span>
            )}
          </div>
        </div>
        <motion.button
          type="button"
          onClick={mark}
          disabled={busy}
          whileHover={{ scale: busy ? 1 : 1.03 }}
          whileTap={{ scale: 0.97 }}
          transition={{ type: "spring", stiffness: 400, damping: 25 }}
          className={cn(
            "relative flex h-32 w-32 flex-col items-center justify-center justify-self-center rounded-full text-white shadow-[0_18px_40px_-14px_rgba(0,0,0,0.45)] ring-8 transition-colors disabled:opacity-70 sm:justify-self-end",
            nextType === "in" ? "bg-gradient-to-b from-emerald-500 to-emerald-700 ring-emerald-100" : "bg-gradient-to-b from-indigo-600 to-indigo-800 ring-indigo-100",
          )}
        >
          {busy && <span className="absolute inset-0 animate-ping rounded-full bg-white/20" aria-hidden="true" />}
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} className="mb-1 h-7 w-7" aria-hidden="true">
            {nextType === "in" ? (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15M12 9l3 3m0 0-3 3m3-3H2.25" />
            ) : (
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 9V5.25A2.25 2.25 0 0 0 13.5 3h-6a2.25 2.25 0 0 0-2.25 2.25v13.5A2.25 2.25 0 0 0 7.5 21h6a2.25 2.25 0 0 0 2.25-2.25V15m3 0 3-3m0 0-3-3m3 3H9" />
            )}
          </svg>
          <span className="text-base font-bold">{busy ? "Saving…" : nextType === "in" ? "Check in" : "Check out"}</span>
        </motion.button>
      </div>

      <div className="flex flex-col gap-3 border-t border-gray-100 pt-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn("inline-flex items-center gap-1.5 rounded-xl px-3 py-2 text-xs font-medium ring-1 ring-inset", chipTone[gpsChip.tone])}>
            <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5 shrink-0" aria-hidden="true">
              <path fillRule="evenodd" d="m9.69 18.933.003.001C9.89 19.02 10 19 10 19s.11.02.308-.066l.002-.001.006-.003.018-.008a5.741 5.741 0 0 0 .281-.14c.186-.096.446-.24.757-.433.62-.384 1.445-.966 2.274-1.765C15.302 14.988 17 12.493 17 9A7 7 0 1 0 3 9c0 3.492 1.698 5.988 3.355 7.584a13.731 13.731 0 0 0 2.273 1.765 11.842 11.842 0 0 0 .976.544l.062.029.018.008.006.003ZM10 11.25a2.25 2.25 0 1 0 0-4.5 2.25 2.25 0 0 0 0 4.5Z" clipRule="evenodd" />
            </svg>
            {gpsChip.text}
          </span>
          {geofenced && gps.state !== "locating" && (
            <button type="button" onClick={locate} className="text-xs font-medium text-indigo-700 hover:underline">
              {gps.state === "idle" ? "Check now" : "Refresh"}
            </button>
          )}
        </div>
        <SelfieCapture value={selfie} onChange={setSelfie} />
      </div>

      <AnimatePresence mode="wait">
        {status && (
          <motion.p
            key={status.text}
            role={status.tone === "error" ? "alert" : "status"}
            initial={{ opacity: 0, y: -4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.2, ease: EASE_OUT }}
            className={cn("rounded-xl px-3.5 py-2.5 text-sm ring-1 ring-inset", tones[status.tone])}
          >
            {status.text}
          </motion.p>
        )}
      </AnimatePresence>
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
