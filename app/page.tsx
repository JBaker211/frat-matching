"use client";

import { signOut } from "firebase/auth";
import { auth } from "@/lib/firebase";

export default function Home() {
  return (
    <main className="min-h-screen flex items-center justify-center p-8">
      <div className="max-w-xl w-full rounded-2xl border p-8 shadow-sm">
        <h1 className="text-3xl font-bold">Frat Matching</h1>
        <p className="mt-2 text-gray-600">
          Server is running. Next step: connect Firebase login + profiles.
        </p>

        <button
          className="mt-6 rounded-lg border px-4 py-2"
          onClick={async () => {
            await signOut(auth);
            window.location.href = "/login";
          }}
        >
          Sign out
        </button>
      </div>
    </main>
  );
}
