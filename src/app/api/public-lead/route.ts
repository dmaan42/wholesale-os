import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const url =
      process.env.SUPABASE_URL ||
      process.env.NEXT_PUBLIC_SUPABASE_URL ||
      "";
    const key =
      process.env.SUPABASE_ANON_KEY ||
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ||
      "";

    if (!url || !key) {
      return NextResponse.json(
        { error: "Missing Supabase keys on the server" },
        { status: 500 }
      );
    }

    const supabase = createClient(url, key);

    const { error } = await supabase.from("public_leads").insert({
      id: crypto.randomUUID(),
      owner_name: body.owner_name || "",
      phone: body.phone || "",
      email: body.email || "",
      address: body.address || "",
      city: body.city || "",
      state: body.state || "",
      zip: body.zip || "",
      motivation: body.motivation || "",
      notes: body.notes || "",
      status: "new",
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }

    return NextResponse.json({ ok: true });
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Unknown error" },
      { status: 500 }
    );
  }
}
