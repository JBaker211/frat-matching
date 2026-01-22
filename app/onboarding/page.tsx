"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db, storage } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type CycleProfile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL: string;

  // pickup gate (actives/admin)
  wantsLittle?: boolean | null;
  maxLittles?: number | null;

  // pledge can optionally want 1–2 bigs (if you added this before)
  maxBigs?: number | null;

  q1_personality: string;
  q2_humor: string;
  q3_hangout: string;
  q4_groupRole: string;
  q5_values: string;
  q6_about: string;

  createdAt?: any;
  updatedAt?: any;
};

export default function OnboardingPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const [role, setRole] = useState<Role | null>(null);
  const [roleLocked, setRoleLocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [currentCycleId, setCurrentCycleId] = useState<string | null>(null);

  // Existing profile for this cycle (if any)
  const [existingProfile, setExistingProfile] = useState<CycleProfile | null>(null);

  // form fields
  const [displayName, setDisplayName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // active pickup gate
  const [wantsLittle, setWantsLittle] = useState<boolean>(true);
  const [maxLittles, setMaxLittles] = useState<number>(1);

  // pledge (optional) wants 1–2 bigs
  const [maxBigs, setMaxBigs] = useState<number>(1);

  // Q1-6
  const [q1Personality, setQ1Personality] = useState("");
  const [q2Humor, setQ2Humor] = useState("");
  const [q3Hangout, setQ3Hangout] = useState("");
  const [q4GroupRole, setQ4GroupRole] = useState("");
  const [q5Values, setQ5Values] = useState("");
  const [q6About, setQ6About] = useState("");

  const isActive = role === "active" || role === "admin";

  const personalityOptions = ["Introvert", "Extrovert", "Ambivert", "Depends on the day"];

  // (your “+” wording version)
  const humorOptions = [
    "Dry + sarcastic",
    "Chaotic + silly",
    "Wholesome",
    "Dark humor (tasteful)",
    "I match the room",
  ];

  const hangoutOptions = ["Chill nights in", "Going out + social", "Adventures + spontaneous", "Gym + active stuff", "A mix"];

  const groupRoleOptions = [
    "Leader + organizer",
    "Supportive + chill",
    "Life of the party",
    "Quiet observer",
    "Connector + brings people together",
  ];

  const valuesOptions = ["Loyalty", "Ambition", "Kindness", "Humor", "Accountability", "Balance"];

  useEffect(() => {
    const unsub = auth.onAuthStateChanged(async (u) => {
      if (!u) {
        setLoading(false);
        return;
      }

      try {
        // Load settings/global -> currentCycleId
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.exists()
          ? (settingsSnap.data()?.currentCycleId as string | undefined)
          : undefined;

        setCurrentCycleId(cid ?? null);

        // Load user doc
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const userData = userSnap.exists() ? (userSnap.data() as any) : {};

        const r = (userData?.role as Role | undefined) ?? null;
        setRole(r);
        setRoleLocked(!!userData?.roleLocked);
        setIsAdmin(!!userData?.isAdmin);

        // If cycle is set, load profile for THIS cycle
        if (cid) {
          const profRef = doc(db, "cycles", cid, "profiles", u.uid);
          const profSnap = await getDoc(profRef);

          if (profSnap.exists()) {
            const p = profSnap.data() as CycleProfile;
            setExistingProfile(p);

            setDisplayName(p.displayName ?? "");
            setQ1Personality(p.q1_personality ?? "");
            setQ2Humor(p.q2_humor ?? "");
            setQ3Hangout(p.q3_hangout ?? "");
            setQ4GroupRole(p.q4_groupRole ?? "");
            setQ5Values(p.q5_values ?? "");
            setQ6About(p.q6_about ?? "");

            if (typeof p.wantsLittle === "boolean") setWantsLittle(!!p.wantsLittle);
            if (typeof p.maxLittles === "number") setMaxLittles(Number(p.maxLittles));
            if (typeof p.maxBigs === "number") setMaxBigs(Number(p.maxBigs));
          } else {
            setExistingProfile(null);
          }
        }

        setLoading(false);
      } catch (e: any) {
        console.error(e);
        setErrorMsg(e?.message ?? "Failed to load onboarding data.");
        setLoading(false);
      }
    });

    return () => unsub();
  }, []);

  useEffect(() => {
    if (!photoFile) {
      setPhotoPreview(null);
      return;
    }
    const url = URL.createObjectURL(photoFile);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photoFile]);

  const allQuestionsFilled = useMemo(() => {
    if (!displayName.trim()) return false;

    // Require photo if this cycle has no existing profile yet
    if (!existingProfile && !photoFile) return false;

    // If active chose not to pick up, still allow profile creation with N/A answers
    if (isActive && wantsLittle === false) return true;

    return (
      q1Personality &&
      q2Humor &&
      q3Hangout &&
      q4GroupRole &&
      q5Values &&
      q6About.trim().length > 0
    );
  }, [
    displayName,
    existingProfile,
    photoFile,
    isActive,
    wantsLittle,
    q1Personality,
    q2Humor,
    q3Hangout,
    q4GroupRole,
    q5Values,
    q6About,
  ]);

  async function handleSaveProfile() {
    setErrorMsg(null);

    const u = auth.currentUser;
    if (!u) return;

    if (!currentCycleId) {
      setErrorMsg("Admin hasn’t set a current cycle yet. Go to /admin.");
      return;
    }

    if (!role || !roleLocked) {
      setErrorMsg("Please choose a role first at /role.");
      return;
    }

    // pledges cannot edit an existing profile in the same cycle
    if (existingProfile && role === "pledge") {
      setErrorMsg("Pledges cannot edit their profile after saving (for this cycle).");
      return;
    }

    if (!allQuestionsFilled) {
      setErrorMsg("Please complete the form.");
      return;
    }

    setSaving(true);
    try {
      let photoURL = existingProfile?.photoURL ?? "";

      // Upload photo if they provided a new one OR if it's their first profile this cycle
      if (photoFile) {
        const photoRef = ref(storage, `profilePhotos/${currentCycleId}/${u.uid}`);
        await uploadBytes(photoRef, photoFile);
        photoURL = await getDownloadURL(photoRef);
      } else if (!photoURL) {
        setErrorMsg("Please upload a profile photo.");
        setSaving(false);
        return;
      }

      const profilePayload: CycleProfile = {
        uid: u.uid,
        role,
        cycleId: currentCycleId,
        displayName: displayName.trim(),
        photoURL,

        wantsLittle: isActive ? wantsLittle : null,
        maxLittles: isActive ? maxLittles : null,
        maxBigs: !isActive ? maxBigs : null,

        q1_personality: isActive && wantsLittle === false ? "N/A" : q1Personality,
        q2_humor: isActive && wantsLittle === false ? "N/A" : q2Humor,
        q3_hangout: isActive && wantsLittle === false ? "N/A" : q3Hangout,
        q4_groupRole: isActive && wantsLittle === false ? "N/A" : q4GroupRole,
        q5_values: isActive && wantsLittle === false ? "N/A" : q5Values,
        q6_about: isActive && wantsLittle === false ? "N/A" : q6About.trim(),

        updatedAt: serverTimestamp(),
        createdAt: existingProfile ? existingProfile.createdAt ?? serverTimestamp() : serverTimestamp(),
      };

      // Save to cycles/{cycleId}/profiles/{uid}
      await setDoc(doc(db, "cycles", currentCycleId, "profiles", u.uid), profilePayload, { merge: true });

      setExistingProfile(profilePayload);

      router.push("/browse");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <AuthGate>
        <div className="p-8">Loading onboarding…</div>
      </AuthGate>
    );
  }

  return (
    <AuthGate>
      <main className="min-h-screen flex items-center justify-center p-6">
        <div className="w-full max-w-2xl rounded-2xl border p-8 shadow-sm">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h1 className="text-3xl font-bold">Create your profile</h1>
              <p className="mt-2 text-gray-600">
                Current cycle:{" "}
                <span className="font-mono font-semibold">{currentCycleId ?? "(not set yet)"}</span>
              </p>
            </div>
            {isAdmin && <div className="rounded-xl border px-3 py-2 text-xs text-gray-700">Admin</div>}
          </div>

          <div className="mt-6 rounded-xl border p-4">
            <div className="text-sm text-gray-700">
              Role: <span className="font-semibold">{role ?? "Not set"}</span>{" "}
              {roleLocked ? <span className="text-green-700">(locked)</span> : <span className="text-red-700">(not locked)</span>}
            </div>
            {!roleLocked && (
              <div className="mt-2 text-sm text-gray-600">
                Go to <span className="font-mono">/role</span> and choose pledge/active.
              </div>
            )}
          </div>

          {existingProfile && (
            <div className="mt-4 rounded-xl border p-4 text-sm text-gray-700">
              Profile exists for this cycle ✅{" "}
              {role === "pledge" ? "(locked for pledges)" : "(editable for actives/admin)"}
            </div>
          )}

          <div className="mt-6 grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="text-sm font-medium text-gray-700">Display name</label>
              <input
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                className="mt-1 w-full rounded-lg border px-3 py-2"
                placeholder="e.g., Jordan"
              />
            </div>

            <div>
              <label className="text-sm font-medium text-gray-700">Profile photo</label>
              <input
                type="file"
                accept="image/*"
                onChange={(e) => setPhotoFile(e.target.files?.[0] ?? null)}
                className="mt-1 w-full"
              />
              {photoPreview && (
                <img src={photoPreview} alt="preview" className="mt-2 h-32 w-32 rounded-xl object-cover border" />
              )}
              {!photoPreview && existingProfile?.photoURL && (
                <img
                  src={existingProfile.photoURL}
                  alt="current"
                  className="mt-2 h-32 w-32 rounded-xl object-cover border"
                />
              )}
            </div>
          </div>

          {/* Active pickup gate */}
          {isActive && (
            <div className="mt-6 rounded-xl border p-4">
              <div className="text-lg font-semibold">Pickup (actives)</div>

              <div className="mt-3">
                <label className="text-sm font-medium text-gray-700">Do you want to take a little this cycle?</label>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWantsLittle(true)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${wantsLittle ? "bg-black text-white" : ""}`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setWantsLittle(false)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${!wantsLittle ? "bg-black text-white" : ""}`}
                  >
                    No
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">Max littles you’re open to (1 or 2)</label>
                <select
                  value={maxLittles}
                  onChange={(e) => setMaxLittles(Number(e.target.value))}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  disabled={!wantsLittle}
                >
                  <option value={1}>1</option>
                  <option value={2}>2</option>
                </select>
              </div>
            </div>
          )}

          {/* Pledge wants 1–2 bigs */}
          {!isActive && (
            <div className="mt-6 rounded-xl border p-4">
              <div className="text-lg font-semibold">Bigs (pledges)</div>
              <label className="mt-2 block text-sm font-medium text-gray-700">How many bigs do you want? (1 or 2)</label>
              <select
                value={maxBigs}
                onChange={(e) => setMaxBigs(Number(e.target.value))}
                className="mt-1 w-full rounded-lg border px-3 py-2"
              >
                <option value={1}>1</option>
                <option value={2}>2</option>
              </select>
            </div>
          )}

          {/* Questions */}
          {!(isActive && wantsLittle === false) && (
            <div className="mt-6 space-y-4">
              <SelectQuestion label="1) Personality" value={q1Personality} setValue={setQ1Personality} options={personalityOptions} />
              <SelectQuestion label="2) Sense of humor" value={q2Humor} setValue={setQ2Humor} options={humorOptions} />
              <SelectQuestion label="3) Ideal hangout" value={q3Hangout} setValue={setQ3Hangout} options={hangoutOptions} />
              <SelectQuestion label="4) In a group, you tend to be…" value={q4GroupRole} setValue={setQ4GroupRole} options={groupRoleOptions} />
              <SelectQuestion label="5) Most important value" value={q5Values} setValue={setQ5Values} options={valuesOptions} />

              <div>
                <label className="text-sm font-medium text-gray-700">
                  6) 1–2 sentences: something you want people to know about you
                </label>
                <textarea
                  value={q6About}
                  onChange={(e) => setQ6About(e.target.value)}
                  rows={3}
                  className="mt-1 w-full rounded-lg border px-3 py-2"
                  placeholder="Keep it short and real."
                />
              </div>
            </div>
          )}

          {errorMsg && (
            <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
              {errorMsg}
            </div>
          )}

          <button
            onClick={handleSaveProfile}
            disabled={saving || !roleLocked || !currentCycleId || !allQuestionsFilled}
            className="mt-6 w-full rounded-lg bg-black text-white py-3 font-semibold disabled:opacity-50"
          >
            {saving ? "Saving…" : existingProfile ? "Save changes" : "Save profile"}
          </button>

          <p className="mt-3 text-xs text-gray-500">After saving, you can browse profiles for this cycle.</p>
        </div>
      </main>
    </AuthGate>
  );
}

function SelectQuestion({
  label,
  value,
  setValue,
  options,
}: {
  label: string;
  value: string;
  setValue: (v: string) => void;
  options: string[];
}) {
  return (
    <div>
      <label className="text-sm font-medium text-gray-700">{label}</label>
      <select value={value} onChange={(e) => setValue(e.target.value)} className="mt-1 w-full rounded-lg border px-3 py-2">
        <option value="">Select…</option>
        {options.map((o) => (
          <option value={o} key={o}>
            {o}
          </option>
        ))}
      </select>
    </div>
  );
}
