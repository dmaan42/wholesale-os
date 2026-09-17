import Stripe from "stripe"
import { NextResponse } from "next/server"

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY as string);

export async function POST() {
try {
const session = await stripe.checkout.sessions.create({
mode: "subscription",
line_items: [
{
price: process.env.STRIPE_PRICE_ID as string,
quantity: 1,
},
],
success_url: "http://wholesale-os-amber.vercel.app/dashboard?paid=1",
cancel_url: "http://wholesale-os-amber.vercel.app/settings",
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
