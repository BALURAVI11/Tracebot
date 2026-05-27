import { NextResponse } from "next/server";

export async function GET() {
  return NextResponse.json({
    hasGeminiKey: !!process.env.GEMINI_API_KEY,
    hasOpenaiKey: !!process.env.OPENAI_API_KEY,
  });
}
