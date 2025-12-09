import Link from "next/link";

export const metadata = {
  title: "Privacy Policy - Fact Check",
  description: "Privacy policy for the Fact Check app",
};

export default function PrivacyPolicy() {
  return (
    <main className="min-h-screen flex flex-col">
      <header className="shrink-0 px-4 py-4 border-b border-zinc-800">
        <div className="max-w-2xl mx-auto">
          <Link href="/" className="text-lg font-semibold hover:text-zinc-300">
            Fact Check
          </Link>
        </div>
      </header>

      <div className="flex-1 p-4">
        <div className="max-w-2xl mx-auto prose prose-invert prose-sm">
          <h1 className="text-2xl font-bold mb-6">Privacy Policy</h1>
          <p className="text-zinc-400 text-sm mb-8">Last updated: December 2024</p>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">What This App Does</h2>
            <p className="text-zinc-300 mb-4">
              Fact Check is a tool that listens to audio, transcribes it, extracts claims,
              and fact-checks them using AI. All processing happens in real-time.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Data We Process</h2>
            <ul className="list-disc list-inside text-zinc-300 space-y-2">
              <li><strong>Audio:</strong> Captured from your microphone when you click &quot;Start Listening&quot;</li>
              <li><strong>Transcripts:</strong> Text converted from your audio</li>
              <li><strong>Claims:</strong> Statements extracted for fact-checking</li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">How Data Is Processed</h2>
            <p className="text-zinc-300 mb-4">
              Your audio and text are sent to third-party AI services for processing:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2">
              <li><strong>OpenAI Whisper:</strong> Converts audio to text</li>
              <li><strong>xAI Grok:</strong> Extracts claims and performs fact-checking</li>
            </ul>
            <p className="text-zinc-300 mt-4">
              These services have their own privacy policies. We recommend reviewing them:
            </p>
            <ul className="list-disc list-inside text-zinc-300 space-y-2 mt-2">
              <li><a href="https://openai.com/privacy" className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">OpenAI Privacy Policy</a></li>
              <li><a href="https://x.ai/legal/privacy-policy" className="text-blue-400 hover:underline" target="_blank" rel="noopener noreferrer">xAI Privacy Policy</a></li>
            </ul>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Data Retention</h2>
            <p className="text-zinc-300">
              <strong>We do not store your data.</strong> Audio and transcripts are processed
              in real-time and discarded. We do not maintain databases of user content.
              Fact-check results are only stored in your browser session and cleared when you
              close the page.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Cookies &amp; Tracking</h2>
            <p className="text-zinc-300">
              This app does not use cookies or tracking analytics. We do not collect personal
              information or track your usage.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Rate Limiting</h2>
            <p className="text-zinc-300">
              To prevent abuse, we temporarily log IP addresses for rate limiting purposes.
              These logs are not stored permanently and are only used to enforce fair usage limits.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Your Rights</h2>
            <p className="text-zinc-300">
              Since we don&apos;t store your data, there&apos;s nothing to delete or export.
              You control the microphone permission in your browser and can revoke it at any time.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Changes</h2>
            <p className="text-zinc-300">
              We may update this policy. Changes will be reflected on this page with an updated date.
            </p>
          </section>

          <section className="mb-8">
            <h2 className="text-lg font-semibold mb-3">Contact</h2>
            <p className="text-zinc-300">
              Questions? Open an issue on the project repository or contact the developer.
            </p>
          </section>
        </div>
      </div>

      <footer className="shrink-0 px-4 py-3 border-t border-zinc-800">
        <p className="text-xs text-center text-zinc-600">
          <Link href="/" className="hover:text-zinc-400">Back to app</Link>
        </p>
      </footer>
    </main>
  );
}
