import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

// NOTE: credentials come from environment variables — never hardcode keys.
// Required in Vercel / .env.local: NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_ANON_KEY
export async function POST(req: Request) {
  try {
    const body = await req.json();

    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    if (!supabaseUrl || !supabaseAnonKey) {
      return NextResponse.json(
        { error: "Supabase is not configured" },
        { status: 500 }
      );
    }
    const supabase = createClient(supabaseUrl, supabaseAnonKey);

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
