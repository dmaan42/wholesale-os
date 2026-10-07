import Stripe from "stripe"
import { NextResponse } from "next/server"

function getStripe() {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) throw new Error("STRIPE_SECRET_KEY is not configured");
  return new Stripe(key);
}

export async function POST() {
try {
const stripe = getStripe();
const appUrl = (process.env.NEXT_PUBLIC_APP_URL || "https://wholesale-os-amber.vercel.app").replace(/\/$/, "");
const session = await stripe.checkout.sessions.create({
mode: "subscription",
line_items: [
{
price: process.env.STRIPE_PRICE_ID as string,
quantity: 1,
},
],
success_url: `${appUrl}/dashboard?paid=1`,
cancel_url: `${appUrl}/settings`,
});

return NextResponse.json({ url: session.url });
} catch (error) {
console.error(error);
return NextResponse.json(
{ error: "Unable to create checkout session" },
{ status: 500 }
);
}
}
