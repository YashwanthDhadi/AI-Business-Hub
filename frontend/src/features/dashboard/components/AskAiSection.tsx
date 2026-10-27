"use client";

import React, { useState } from "react";
import Link from "next/link";
import { Sparkles, Send, Mic, MicOff, Bot, ArrowRight } from "lucide-react";
import { Button, Card, Badge } from "@/components/ui";
import { answerBusinessQuestion, AiResponse } from "../askAi";

interface AskAiSectionProps {
  /** Question passed from the header "Ask AI" bar; answered immediately. */
  initialQuery?: string;
}

export function AskAiSection({ initialQuery }: AskAiSectionProps = {}) {
  const [query, setQuery] = useState(initialQuery ?? "");
  const [isListening, setIsListening] = useState(false);
  const [response, setResponse] = useState<AiResponse | null>(() => (initialQuery ? answerBusinessQuestion(initialQuery) : null));
  const [isProcessing, setIsProcessing] = useState(false);

  const suggestions = [
    "Show today's bookings",
    "Who hasn't paid?",
    "Show low-stock products",
    "Give me this week's summary",
  ];

  const handleQuery = (text: string) => {
    if (!text.trim()) return;
    setQuery(text);
    setIsProcessing(true);

    // Simulated lookup delay; answers are computed from mock data
    setTimeout(() => {
      setIsProcessing(false);
      setResponse(answerBusinessQuestion(text));
    }, 450);
  };

  const toggleVoiceInput = () => {
    if (!isListening) {
      setIsListening(true);
      // Simulate speech recognition transcription
      setTimeout(() => {
        setIsListening(false);
        handleQuery("Show today's bookings");
      }, 1800);
    } else {
      setIsListening(false);
    }
  };

  return (
    <Card className="border-indigo-500/30 bg-gradient-to-b from-indigo-950/20 via-gray-900/60 to-gray-900/90 shadow-xl overflow-hidden">
      <div className="space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 flex-shrink-0 rounded-lg bg-indigo-600/20 border border-indigo-500/30 flex items-center justify-center text-indigo-400">
              <Sparkles className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-base font-bold text-white tracking-tight">
                Ask AI Assistant
              </h3>
              <p className="text-xs text-gray-400">
                Ask questions about your business in normal plain English
              </p>
            </div>
          </div>
          <Badge variant="brand" className="hidden sm:inline-flex">Answers from your business data</Badge>
        </div>

        {/* Query Input Bar */}
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleQuery(query);
          }}
          className="relative flex items-center"
        >
          <input
            type="text"
            placeholder="What would you like to know about your business today?"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="w-full rounded-xl bg-gray-950/90 border border-gray-800 pl-4 pr-24 py-3 text-sm text-gray-100 placeholder-gray-500 focus:outline-none focus:border-indigo-500 transition-colors shadow-inner"
          />

          <div className="absolute right-2 flex items-center gap-1.5">
            {/* Voice Input Button */}
            <button
              type="button"
              onClick={toggleVoiceInput}
              title={isListening ? "Listening... click to stop" : "Use microphone input"}
              className={`p-2 rounded-lg text-xs transition-colors cursor-pointer ${
                isListening
                  ? "bg-rose-600 text-white animate-pulse"
                  : "text-gray-400 hover:text-white hover:bg-gray-800"
              }`}
            >
              {isListening ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
            </button>

            {/* Submit Button */}
            <Button
              type="submit"
              variant="primary"
              size="sm"
              disabled={!query.trim()}
              isLoading={isProcessing}
              className="px-3"
            >
              <Send className="w-3.5 h-3.5" />
            </Button>
          </div>
        </form>

        {/* Suggestion Chips */}
        <div className="flex flex-wrap items-center gap-2 pt-1">
          <span className="text-[11px] text-gray-500 font-medium">Suggestions:</span>
          {suggestions.map((sug) => (
            <button
              key={sug}
              type="button"
              onClick={() => handleQuery(sug)}
              className="text-xs px-2.5 py-1 rounded-full border border-gray-800 bg-gray-900/80 text-gray-300 hover:text-white hover:border-indigo-500/40 hover:bg-indigo-950/30 transition-all cursor-pointer"
            >
              &ldquo;{sug}&rdquo;
            </button>
          ))}
        </div>

        {/* Simulated AI Response Card */}
        {response && (
          <div className="mt-4 pt-4 border-t border-gray-800/80 rounded-xl bg-gray-950/70 border border-indigo-500/20 p-4 space-y-3 animate-in fade-in duration-300">
            <div className="flex items-start gap-2.5">
              <div className="w-6 h-6 rounded-md bg-indigo-600 flex items-center justify-center text-white flex-shrink-0 mt-0.5">
                <Bot className="w-3.5 h-3.5" />
              </div>
              <div className="space-y-1 flex-1">
                <span className="text-xs font-semibold text-indigo-300">
                  AI Business Hub Response
                </span>
                <p className="text-sm text-gray-200 leading-relaxed">
                  {response.answer}
                </p>
              </div>
            </div>

            {/* Structured details list */}
            {response.details && (
              <div className="ml-8 space-y-2 pt-2 border-t border-gray-900">
                <ul className="space-y-1.5 text-xs text-gray-300">
                  {response.details.items.map((item, idx) => (
                    <li key={idx} className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-indigo-400" />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>

                <div className="pt-2">
                  <Link href={response.details.actionHref}>
                    <Button variant="secondary" size="sm" className="text-xs">
                      {response.details.actionLabel}
                      <ArrowRight className="w-3 h-3 ml-1" />
                    </Button>
                  </Link>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </Card>
  );
}
