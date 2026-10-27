import Link from "next/link";
import { MessageSquareOff } from "lucide-react";

export default function ChatNotFound() {
  return (
    <div className="min-h-[100dvh] flex items-center justify-center p-6">
      <div className="max-w-sm text-center space-y-3">
        <div className="w-12 h-12 rounded-xl bg-gray-800 text-gray-400 flex items-center justify-center mx-auto">
          <MessageSquareOff className="w-6 h-6" />
        </div>
        <h1 className="text-lg font-bold text-white">This chat link isn&apos;t active</h1>
        <p className="text-sm text-gray-400">The business may have changed its link. Please check with them directly.</p>
        <Link href="/" className="inline-block text-sm text-indigo-400 hover:text-indigo-300">
          Go to AI Business Hub
        </Link>
      </div>
    </div>
  );
}
