"use client";

import { useEffect, useMemo, useState } from "react";
import AuthGate from "@/app/components/AuthGate";
import { auth, db, storage } from "@/lib/firebase";
import { doc, getDoc, setDoc, serverTimestamp } from "firebase/firestore";
import { ref, uploadBytes, getDownloadURL } from "firebase/storage";
import { useRouter } from "next/navigation";

type Role = "pledge" | "active" | "admin";

type ExistingProfile = {
  uid: string;
  role: Role;
  cycleId: string;
  displayName: string;
  photoURL: string;

  wantsLittle?: boolean | null;
  maxLittles?: number | null;

  q1_personality?: string;
  q2_humor?: string;
  q3_hangout?: string;
  q4_groupRole?: string;
  q5_values?: string;
  q6_about?: string;

  createdAt?: any;
  updatedAt?: any;
};

export default function OnboardingPage() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);

  const [role, setRole] = useState<Role | null>(null);
  const [roleLocked, setRoleLocked] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);

  const [currentCycleId, setCurrentCycleId] = useState<string | null>(null);

  // Existing profile for THIS cycle (cycles/{cycleId}/profiles/{uid})
  const [existingProfileForCycle, setExistingProfileForCycle] =
    useState<ExistingProfile | null>(null);

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
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const isActive = role === "active" || role === "admin";
  const canQuickFinishActive = isActive && wantsLittle === false;

  // If profile exists this cycle:
  // - pledges cannot edit
  // - actives/admin can edit
  const profileLockedForThisUser = !!existingProfileForCycle && role === "pledge";

  // Options (with + like you wanted)
  const personalityOptions = ["Introvert", "Extrovert", "Ambivert", "Depends on the day"];

  const humorOptions = [
    "Dry + sarcastic",
    "Chaotic + silly",
    "Wholesome",
    "Dark + tasteful",
    "I match the room",
  ];

  const hangoutOptions = [
    "Chill nights in",
    "Going out + social",
    "Adventures + spontaneous",
    "Gym + active stuff",
    "A mix",
  ];

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
        // 1) current cycle from settings/global
        const settingsSnap = await getDoc(doc(db, "settings", "global"));
        const cid = settingsSnap.exists()
          ? (settingsSnap.data()?.currentCycleId as string | undefined)
          : undefined;
        const cycle = cid ?? null;
        setCurrentCycleId(cycle);

        // 2) user doc
        const userSnap = await getDoc(doc(db, "users", u.uid));
        const userData = userSnap.exists() ? (userSnap.data() as any) : {};

        const r = (userData?.role as Role | undefined) ?? null;
        setRole(r);
        setRoleLocked(!!userData?.roleLocked);
        setIsAdmin(!!userData?.isAdmin);

        // pickup gate defaults
        if (typeof userData?.wantsLittle === "boolean") setWantsLittle(!!userData.wantsLittle);
        if (typeof userData?.maxLittles === "number") setMaxLittles(Number(userData.maxLittles));

        // 3) load existing profile for THIS cycle (IMPORTANT PATH!)
        if (cycle) {
          const profRef = doc(db, "cycles", cycle, "profiles", u.uid);
          const profSnap = await getDoc(profRef);

          if (profSnap.exists()) {
            const p = profSnap.data() as any;
            const existing = p as ExistingProfile;
            setExistingProfileForCycle(existing);

            setDisplayName(existing.displayName ?? "");
            setQ1Personality(existing.q1_personality ?? "");
            setQ2Humor(existing.q2_humor ?? "");
            setQ3Hangout(existing.q3_hangout ?? "");
            setQ4GroupRole(existing.q4_groupRole ?? "");
            setQ5Values(existing.q5_values ?? "");
            setQ6About(existing.q6_about ?? "");

            if (typeof existing.wantsLittle === "boolean") setWantsLittle(!!existing.wantsLittle);
            if (typeof existing.maxLittles === "number") setMaxLittles(Number(existing.maxLittles));
          } else {
            setExistingProfileForCycle(null);
          }
        } else {
          setExistingProfileForCycle(null);
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

  useEffect(() => {
    // If active flips No -> Yes, clear N/A so they must answer
    if (isActive && wantsLittle === true) {
      if (q1Personality === "N/A") setQ1Personality("");
      if (q2Humor === "N/A") setQ2Humor("");
      if (q3Hangout === "N/A") setQ3Hangout("");
      if (q4GroupRole === "N/A") setQ4GroupRole("");
      if (q5Values === "N/A") setQ5Values("");
      if (q6About === "N/A") setQ6About("");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wantsLittle, isActive]);

  const allQuestionsFilled = useMemo(() => {
    if (!displayName.trim()) return false;

    // If pledge is locked, no validation needed
    if (profileLockedForThisUser) return true;

    const firstTimeThisCycle = !existingProfileForCycle;

    // Require photo only the first time this cycle
    if (firstTimeThisCycle && !photoFile) return false;

    // If active chose "No", allow finishing without Q1-6
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
    existingProfileForCycle,
    profileLockedForThisUser,
    canQuickFinishActive,
    q1Personality,
    q2Humor,
    q3Hangout,
    q4GroupRole,
    q5Values,
    q6About,
  ]);

  async function handleSaveProfile() {
    console.log("ONBOARDING BUILD MARKER:", "LIVE-DEPLOY-CHECK-001"); // <-- leave for now
    setErrorMsg(null);

    const u = auth.currentUser;
    if (!u?.uid) {
      setErrorMsg("Session expired. Please log out and sign back in.");
      return;
    }

    if (!currentCycleId) {
      setErrorMsg("Admin hasn’t set a current cycle yet (settings/global.currentCycleId).");
      return;
    }

    if (!role || !roleLocked) {
      setErrorMsg("Please choose a role first (/role).");
      return;
    }

    if (!displayName.trim()) {
      setErrorMsg("Please enter your name.");
      return;
    }

    if (profileLockedForThisUser) {
      setErrorMsg("Pledge profiles are locked for this cycle.");
      return;
    }

    if (!allQuestionsFilled) {
      setErrorMsg("Please complete the form.");
      return;
    }

    setSaving(true);

    try {
      const userRef = doc(db, "users", u.uid);

      // Always ensure/merge user doc (your rules allow owner update)
      await setDoc(
        userRef,
        {
          uid: u.uid,
          role,
          roleLocked: true,
          isAdmin: role === "admin",
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      // Photo: upload only if user chose a new file
      let photoURL = existingProfileForCycle?.photoURL ?? "";
      if (photoFile) {
        const photoRef = ref(storage, `profilePhotos/${currentCycleId}/${u.uid}`);
        await uploadBytes(photoRef, photoFile);
        photoURL = await getDownloadURL(photoRef);
      }

      const quickFinish = isActive && wantsLittle === false;

      // IMPORTANT PATH: cycles/{cycleId}/profiles/{uid}
      const profileRef = doc(db, "cycles", currentCycleId, "profiles", u.uid);

      // If profile exists, actives/admin can update; pledges blocked above.
      await setDoc(
        profileRef,
        {
          uid: u.uid,
          role,
          cycleId: currentCycleId,
          displayName: displayName.trim(),
          photoURL,

          wantsLittle: isActive ? wantsLittle : null,
          maxLittles: isActive ? maxLittles : null,

          q1_personality: quickFinish ? "N/A" : q1Personality,
          q2_humor: quickFinish ? "N/A" : q2Humor,
          q3_hangout: quickFinish ? "N/A" : q3Hangout,
          q4_groupRole: quickFinish ? "N/A" : q4GroupRole,
          q5_values: quickFinish ? "N/A" : q5Values,
          q6_about: quickFinish ? "N/A" : q6About.trim(),

          createdAt: existingProfileForCycle?.createdAt ?? serverTimestamp(),
          updatedAt: serverTimestamp(),
        },
        { merge: !!existingProfileForCycle } // update vs create
      );

      // Optional: keep pickup settings mirrored in user doc
      await setDoc(
        userRef,
        {
          wantsLittle: isActive ? wantsLittle : null,
          maxLittles: isActive ? maxLittles : null,
          updatedAt: serverTimestamp(),
        },
        { merge: true }
      );

      router.push("/browse");
    } catch (e: any) {
      console.error(e);
      if (String(e?.message || "").includes("Missing or insufficient permissions")) {
        setErrorMsg(
          "Missing or insufficient permissions (Firestore rules). This almost always means the app is writing to a path not allowed by your rules."
        );
      } else if (String(e?.message || "").includes("storage/unauthorized")) {
        setErrorMsg("Storage unauthorized. Your Storage rules are denying the upload path.");
      } else {
        setErrorMsg(e?.message ?? "Failed to save profile.");
      }
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
                Answer a few quick questions and upload a photo. After saving, you can browse profiles.
              </p>
              <p className="mt-1 text-sm text-gray-500">
                Current cycle:{" "}
                <span className="font-medium">
                  {currentCycleId ?? "Not set (admin must set settings/global.currentCycleId)"}
                </span>
              </p>
            </div>
            {isAdmin && (
              <div className="rounded-xl border px-3 py-2 text-xs text-gray-700">Admin</div>
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
                Your role isn’t locked yet. Go to <span className="font-mono">/role</span> and choose pledge/active.
              </div>
            )}
          </div>

          {/* If pledge locked */}
          {profileLockedForThisUser ? (
            <div className="mt-6 rounded-xl border p-4">
              <div className="text-lg font-semibold">Profile saved ✅</div>
              <p className="mt-1 text-gray-600">Your pledge profile is locked for this cycle.</p>
              <button
                onClick={() => router.push("/browse")}
                className="mt-4 w-full rounded-lg bg-black text-white py-2 font-medium"
              >
                Go to Browse
              </button>
            </div>
          ) : (
            <>
              {/* Active pickup gate */}
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

                    {!wantsLittle && (
                      <p className="mt-2 text-sm text-gray-600">
                        If you’re not picking up, you can finish without the personality questions.
                      </p>
                    )}
                  </div>
                </div>
              )}

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
                  {photoPreview ? (
                    <img
                      src={photoPreview}
                      alt="preview"
                      className="mt-2 h-32 w-32 rounded-xl object-cover border"
                    />
                  ) : existingProfileForCycle?.photoURL ? (
                    <img
                      src={existingProfileForCycle.photoURL}
                      alt="current"
                      className="mt-2 h-32 w-32 rounded-xl object-cover border"
                    />
                  ) : null}
                </div>
              </div>

              {/* Questions */}
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

              {errorMsg && (
                <div className="mt-6 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                  {errorMsg}
                </div>
              )}

              <button
                onClick={handleSaveProfile}
                disabled={saving || !roleLocked || !allQuestionsFilled || !currentCycleId}
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
