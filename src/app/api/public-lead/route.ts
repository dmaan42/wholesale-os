import { NextResponse } from "next/server";
import { createClient } from "@supabase/supabase-js";

export async function POST(req: Request) {
  const body = await req.json();
  const supabase = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

  const { error } = await supabase.from("public_leads").insert({
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
}
