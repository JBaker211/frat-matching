"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db, storage } from "@/lib/firebase";
import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

export default function OnboardingPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<Role | null>(null);
  const [roleLocked, setRoleLocked] = useState<boolean>(false);
  const [profileComplete, setProfileComplete] = useState<boolean>(false);
  const [isAdmin, setIsAdmin] = useState<boolean>(false);

  const [currentCycleId, setCurrentCycleId] = useState<string | null>(null);

  // form fields
  const [displayName, setDisplayName] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  // active pickup gate
  const [wantsLittle, setWantsLittle] = useState<boolean>(true);
  const [maxLittles, setMaxLittles] = useState<number>(1);

  // Q1-6
  const [q1Personality, setQ1Personality] = useState("");
  const [q2Humor, setQ2Humor] = useState("");
  const [q3Hangout, setQ3Hangout] = useState("");
  const [q4GroupRole, setQ4GroupRole] = useState("");
  const [q5Values, setQ5Values] = useState("");
  const [q6About, setQ6About] = useState("");

  const [saving, setSaving] = useState(false);
  const [savingPickup, setSavingPickup] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [infoMsg, setInfoMsg] = useState<string | null>(null);

  const isActive = role === "active" || role === "admin";
  const canQuickFinishActive = isActive && wantsLittle === false;

  // Your preferred “+” wording
  const personalityOptions = ["Introvert", "Extrovert", "Ambivert", "Depends on the day"];
  const humorOptions = ["Dry + sarcastic", "Chaotic + silly", "Wholesome", "Dark humor (tasteful)", "I match the room"];
  const hangoutOptions = ["Chill nights in", "Going out + social", "Adventures + spontaneous", "Gym + active stuff", "A mix"];
  const groupRoleOptions = ["Leader + organizer", "Supportive + chill", "Life of the party", "Quiet observer", "Connector + brings people together"];
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
        setProfileComplete(!!userData?.profileComplete);
        setIsAdmin(!!userData?.isAdmin);

        // Pre-fill pickup gate if exists
        if (typeof userData?.wantsLittle === "boolean") setWantsLittle(!!userData.wantsLittle);
        if (typeof userData?.maxLittles === "number") setMaxLittles(Number(userData.maxLittles));

        // If profile exists, prefill displayName + questions + pickup
        const profSnap = await getDoc(doc(db, "profiles", u.uid));
        if (profSnap.exists()) {
          const p = profSnap.data() as any;
          setDisplayName(p.displayName ?? "");
          setQ1Personality(p.q1_personality ?? "");
          setQ2Humor(p.q2_humor ?? "");
          setQ3Hangout(p.q3_hangout ?? "");
          setQ4GroupRole(p.q4_groupRole ?? "");
          setQ5Values(p.q5_values ?? "");
          setQ6About(p.q6_about ?? "");
          if (typeof p.wantsLittle === "boolean") setWantsLittle(!!p.wantsLittle);
          if (typeof p.maxLittles === "number") setMaxLittles(Number(p.maxLittles));
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

    // Require photo on initial create only
    if (!photoFile) return false;

    // If active said "No", allow saving without questions
    if (canQuickFinishActive) return true;

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
    photoFile,
    canQuickFinishActive,
    q1Personality,
    q2Humor,
    q3Hangout,
    q4GroupRole,
    q5Values,
    q6About,
  ]);

  async function handleSavePickupSettings() {
    setErrorMsg(null);
    setInfoMsg(null);

    const u = auth.currentUser;
    if (!u) {
      setErrorMsg("Not signed in.");
      return;
    }
    if (!currentCycleId) {
      setErrorMsg("Admin hasn’t set a current cycle yet (settings/global.currentCycleId).");
      return;
    }
    if (!isActive) {
      setErrorMsg("Pickup settings are only for actives/admin.");
      return;
    }

    setSavingPickup(true);
    try {
      // Update users doc (your rules allow this after profileComplete)
      await setDoc(
        doc(db, "users", u.uid),
        {
          wantsLittle,
          maxLittles,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Update profile doc if it exists (your rules allow these fields)
      await setDoc(
        doc(db, "profiles", u.uid),
        {
          wantsLittle,
          maxLittles,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setInfoMsg("Pickup settings saved ✅");
    } catch (e: any) {
      console.error(e);
      setErrorMsg(e?.message ?? "Failed to save pickup settings.");
    } finally {
      setSavingPickup(false);
    }
  }

  async function handleSaveProfileFirstTime() {
    setErrorMsg(null);
    setInfoMsg(null);

    const u = auth.currentUser;
    if (!u) {
      setErrorMsg("Not signed in.");
      return;
    }

    if (!currentCycleId) {
      setErrorMsg("Admin hasn’t set a current cycle yet (settings/global.currentCycleId).");
      return;
    }

    if (!role || !roleLocked) {
      setErrorMsg("Please choose a role first.");
      return;
    }

    // Admins don’t *need* a profile. They can skip.
    // (But they still can create one if they want.)
    // If admin wants to skip, they can just go browse/admin pages.
    if (role === "admin") {
      // Allow creating admin profile too, so we continue normally if they hit save.
    }

    if (!allQuestionsFilled) {
      setErrorMsg("Please complete the form (name, photo, and required questions).");
      return;
    }

    setSaving(true);
    try {
      // Upload photo: profilePhotos/{cycleId}/{uid}
      const photoRef = ref(storage, `profilePhotos/${currentCycleId}/${u.uid}`);
      await uploadBytes(photoRef, photoFile!);
      const photoURL = await getDownloadURL(photoRef);

      const profilePayload: any = {
        uid: u.uid,
        role,
        cycleId: currentCycleId,
        displayName: displayName.trim(),
        photoURL,

        wantsLittle: isActive ? wantsLittle : null,
        maxLittles: isActive ? maxLittles : null,

        q1_personality: canQuickFinishActive ? "N/A" : q1Personality,
        q2_humor: canQuickFinishActive ? "N/A" : q2Humor,
        q3_hangout: canQuickFinishActive ? "N/A" : q3Hangout,
        q4_groupRole: canQuickFinishActive ? "N/A" : q4GroupRole,
        q5_values: canQuickFinishActive ? "N/A" : q5Values,
        q6_about: canQuickFinishActive ? "N/A" : q6About.trim(),

        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      };

      // Create profile
      await setDoc(doc(db, "profiles", u.uid), profilePayload, { merge: false });

      // Mark user complete
      await setDoc(
        doc(db, "users", u.uid),
        {
          profileComplete: true,
          wantsLittle: isActive ? wantsLittle : null,
          maxLittles: isActive ? maxLittles : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      setProfileComplete(true);
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
                Upload a photo and answer a few quick questions.
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Current cycle:{" "}
                <span className="font-medium">
                  {currentCycleId ?? "Not set (admin must set it in /admin)"}
                </span>
              </p>
            </div>
            {isAdmin && (
              <div className="rounded-xl border px-3 py-2 text-xs text-gray-700">
                Admin
              </div>
            )}
          </div>

          {/* Role status */}
          <div className="mt-6 rounded-xl border p-4">
            <div className="text-sm text-gray-700">
              Role: <span className="font-semibold">{role ?? "Not set"}</span>{" "}
              {roleLocked ? (
                <span className="text-green-700">(locked)</span>
              ) : (
                <span className="text-red-700">(not locked)</span>
              )}
            </div>
            {!roleLocked && (
              <div className="mt-2 text-sm text-gray-600">
                Go to <span className="font-mono">/role</span> and choose pledge/active.
              </div>
            )}
          </div>

          {/* Admin shortcut if they don't want a profile */}
          {role === "admin" && !profileComplete && (
            <div className="mt-6 rounded-xl border p-4">
              <div className="font-semibold">Admin shortcut</div>
              <p className="mt-1 text-sm text-gray-600">
                As admin, you don’t need a profile to manage the cycle and release preferences.
              </p>
              <div className="mt-3 flex gap-3">
                <button
                  onClick={() => router.push("/admin")}
                  className="flex-1 rounded-lg bg-black text-white py-2 font-medium"
                >
                  Go to Admin
                </button>
                <button
                  onClick={() => router.push("/browse")}
                  className="flex-1 rounded-lg border py-2 font-medium"
                >
                  Browse
                </button>
              </div>
            </div>
          )}

          {/* Pickup settings ALWAYS editable for actives/admin (even after profileComplete) */}
          {isActive && (
            <div className="mt-6 rounded-xl border p-4">
              <div className="text-lg font-semibold">Pickup settings (actives)</div>

              <div className="mt-3">
                <label className="text-sm font-medium text-gray-700">
                  Do you want to take a little this cycle?
                </label>
                <div className="mt-2 flex gap-3">
                  <button
                    type="button"
                    onClick={() => setWantsLittle(true)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      wantsLittle ? "bg-black text-white" : ""
                    }`}
                  >
                    Yes
                  </button>
                  <button
                    type="button"
                    onClick={() => setWantsLittle(false)}
                    className={`rounded-lg border px-3 py-2 text-sm font-medium ${
                      !wantsLittle ? "bg-black text-white" : ""
                    }`}
                  >
                    No
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <label className="text-sm font-medium text-gray-700">
                  Max littles you’re open to (1 or 2)
                </label>
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

              <button
                onClick={handleSavePickupSettings}
                disabled={savingPickup || !currentCycleId}
                className="mt-4 w-full rounded-lg border py-2 font-semibold disabled:opacity-50"
              >
                {savingPickup ? "Saving…" : "Save pickup settings"}
              </button>

              <p className="mt-2 text-xs text-gray-500">
                You can change these anytime. (Your profile answers remain as-is unless you rebuild a profile per cycle.)
              </p>
            </div>
          )}

          {/* If profile already saved */}
          {profileComplete ? (
            <div className="mt-6 rounded-xl border p-4">
              <div className="text-lg font-semibold">Profile saved ✅</div>
              <p className="mt-1 text-gray-600">
                You can browse profiles now.
              </p>
              <button
                onClick={() => router.push("/browse")}
                className="mt-4 w-full rounded-lg bg-black text-white py-2 font-medium"
              >
                Go to Browse
              </button>
            </div>
          ) : (
            <>
              {/* Name + photo */}
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
                    <img
                      src={photoPreview}
                      alt="preview"
                      className="mt-2 h-32 w-32 rounded-xl object-cover border"
                    />
                  )}
                </div>
              </div>

              {/* Questions (skip if active not picking up) */}
              {!canQuickFinishActive && (
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

              {/* Messages */}
              {errorMsg && (
                <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {errorMsg}
                </div>
              )}
              {infoMsg && (
                <div className="mt-6 rounded-xl border border-green-200 bg-green-50 p-4 text-sm text-green-800">
                  {infoMsg}
                </div>
              )}

              {/* Save */}
              <button
                onClick={handleSaveProfileFirstTime}
                disabled={saving || !roleLocked || !currentCycleId || !allQuestionsFilled}
                className="mt-6 w-full rounded-lg bg-black text-white py-3 font-semibold disabled:opacity-50"
              >
                {saving ? "Saving…" : "Save Profile"}
              </button>

              <p className="mt-3 text-xs text-gray-500">
                After saving, you’ll be able to browse profiles. Only admins can see matching scores.
              </p>
            </>
          )}
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
      <select
        value={value}
        onChange={(e) => setValue(e.target.value)}
        className="mt-1 w-full rounded-lg border px-3 py-2"
      >
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
