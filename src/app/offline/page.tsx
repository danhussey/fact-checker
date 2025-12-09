"use client";

export default function OfflinePage() {
  return (
    <div className="flex min-h-screen flex-col items-center justify-center p-6 text-center">
      <div className="mb-6 text-6xl">📡</div>
      <h1 className="mb-4 text-2xl font-semibold">You&apos;re offline</h1>
      <p className="max-w-sm text-zinc-400">
        Fact-checking requires an internet connection to search for sources.
        Please reconnect and try again.
      </p>
      <button
        onClick={() => window.location.reload()}
        className="mt-8 rounded-full bg-white px-6 py-3 font-medium text-black transition-colors hover:bg-zinc-200"
      >
        Try again
      </button>
    </div>
  );
}
