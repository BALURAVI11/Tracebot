import { NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function GET() {
  try {
    const conversations = await prisma.conversation.findMany({
      orderBy: { updatedAt: "desc" },
      include: {
        _count: {
          select: { messages: true },
        },
      },
    });

    const formatted = conversations.map((c) => ({
      id: c.id,
      title: c.title,
      createdAt: c.createdAt,
      updatedAt: c.updatedAt,
      messageCount: c._count.messages,
    }));

    return NextResponse.json(formatted);
  } catch (error: any) {
    console.error("[Conversations API] GET error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}

export async function DELETE() {
  try {
    // Delete all conversations (wipes logs & messages cascadingly)
    await prisma.conversation.deleteMany({});
    // Also delete any standalone logs
    await prisma.inferenceLog.deleteMany({});
    
    return NextResponse.json({ success: true, message: "Cleared all database records" });
  } catch (error: any) {
    console.error("[Conversations API] DELETE error:", error);
    return NextResponse.json(
      { error: "Internal Server Error", details: error?.message || String(error) },
      { status: 500 }
    );
  }
}
