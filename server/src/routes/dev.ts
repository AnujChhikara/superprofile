import { Router } from "express";
import { db, newId } from "../db/client.js";
import {
  workspaces,
  memberships,
  contacts,
  conversations,
  messages,
  kbCategories,
  kbArticles,
} from "../db/schema.js";
import { eq } from "drizzle-orm";
import { requireAuth } from "../auth/middleware.js";
import { articleText } from "../lib/sanitize.js";

// Fixed identifiers so the seed is idempotent and /demo can find the workspace.
const DEMO_WS = "demo-acme-ws";
export const DEMO_PUBLIC_KEY = "pk_rapidco_demo_000000000000000000";

export const devRouter = Router();

// POST /api/dev/seed — creates/refreshes the "Acme Cloud" demo workspace and
// adds the calling user as an admin so they can see it. Idempotent.
devRouter.post("/seed", requireAuth, async (req, res) => {
  try {
    const userId = req.user!.id;

    // 1) Workspace (upsert by fixed id).
    const existing = (
      await db.select().from(workspaces).where(eq(workspaces.id, DEMO_WS))
    )[0];
    if (!existing) {
      await db.insert(workspaces).values({
        id: DEMO_WS,
        name: "Rapid Commerce",
        slug: "rapid_commerce",
        publicKey: DEMO_PUBLIC_KEY,
      });
    }

    // 2) Membership for the caller.
    const mem = (
      await db
        .select()
        .from(memberships)
        .where(eq(memberships.workspaceId, DEMO_WS))
    ).find((m) => m.userId === userId);
    if (!mem) {
      await db.insert(memberships).values({
        id: newId(),
        userId,
        workspaceId: DEMO_WS,
        role: "admin",
      });
    }

    // 3) Wipe prior demo content (keep workspace + memberships).
    await db.delete(messages).where(eq(messages.workspaceId, DEMO_WS));
    await db.delete(conversations).where(eq(conversations.workspaceId, DEMO_WS));
    await db.delete(contacts).where(eq(contacts.workspaceId, DEMO_WS));
    await db.delete(kbArticles).where(eq(kbArticles.workspaceId, DEMO_WS));
    await db.delete(kbCategories).where(eq(kbCategories.workspaceId, DEMO_WS));

    // 4) KB: 2 categories + 2 rich articles.
    const catOnboarding = newId();
    const catPolicies   = newId();
    await db.insert(kbCategories).values([
      { id: catOnboarding, workspaceId: DEMO_WS, name: "Getting Started", slug: "getting-started", position: 0 },
      { id: catPolicies,   workspaceId: DEMO_WS, name: "Policies",        slug: "policies",        position: 1 },
    ]);

    const art = (
      title: string, slug: string, categoryId: string,
      bodyHtml: string,
    ) => ({ id: newId(), workspaceId: DEMO_WS, categoryId, title, slug, bodyHtml, bodyText: articleText(bodyHtml), status: "published" as const });

    await db.insert(kbArticles).values([
      // ── Article 1: Full onboarding guide ────────────────────────────
      art("How to launch your online business with Rapid Commerce", "launch-online-business", catOnboarding,
        `<p><strong>Rapid Commerce</strong> is an all-in-one e-commerce platform that lets you launch a fully-featured online store in minutes — no coding, no design skills, no upfront investment needed. This guide walks you through every step from creating your account to making your first sale.</p>

<h2>Step 1: Create your account</h2>
<p>Go to <strong>rapidcommerce.io</strong> and click <em>Get Started Free</em>. Sign up with your email address or Google account. You get a <strong>14-day free trial</strong> — no credit card required. After signing up you'll be taken to your store dashboard.</p>

<h2>Step 2: Set up your store profile</h2>
<p>Before adding products, fill in your store details:</p>
<ul>
  <li><strong>Store name</strong> — this appears on your storefront and in customer emails.</li>
  <li><strong>Store logo</strong> — upload a PNG or SVG (recommended size: 200 × 60 px).</li>
  <li><strong>Business address</strong> — required for GST invoices and COD eligibility.</li>
  <li><strong>Contact email</strong> — shown to customers on order confirmation emails.</li>
</ul>
<p>Go to <strong>Settings → Store Profile</strong> to fill these in.</p>

<h2>Step 3: Add your products</h2>
<p>Go to <strong>Products → Add Product</strong> and fill in:</p>
<ul>
  <li><strong>Product name and description</strong> — be specific; good descriptions improve search rankings.</li>
  <li><strong>Price and compare-at price</strong> — set a compare-at price to show a strikethrough "original" price.</li>
  <li><strong>Inventory quantity</strong> — Rapid Commerce tracks stock and hides out-of-stock products automatically.</li>
  <li><strong>Product images</strong> — upload up to 10 images per product (JPG or PNG, max 5 MB each). First image is the thumbnail.</li>
  <li><strong>Variants</strong> — if your product comes in sizes or colours, add variants so customers can choose.</li>
  <li><strong>Category and tags</strong> — help customers find your products through search and filters.</li>
</ul>
<p>Click <strong>Publish</strong> when ready. Your product appears on your storefront instantly.</p>

<h2>Step 4: Connect a payment gateway</h2>
<p>You need a payment gateway to accept money from customers. Go to <strong>Settings → Payments</strong> and connect one or more of the following:</p>
<ul>
  <li><strong>Razorpay</strong> — best for Indian businesses. Accepts UPI, credit/debit cards, net banking, wallets, and EMI. Instant onboarding with your PAN and bank account details.</li>
  <li><strong>Stripe</strong> — best if you sell internationally (USD, EUR, GBP). Requires a business bank account.</li>
  <li><strong>PayPal</strong> — widely trusted for international buyers.</li>
  <li><strong>Cash on Delivery (COD)</strong> — available after connecting Razorpay. Toggle on from Settings → Payments → COD. Available in 20,000+ pin codes across India.</li>
</ul>
<p>Once connected, customers can pay immediately at checkout. Payouts hit your bank account within 2 business days (Razorpay) or 7 days (Stripe/PayPal).</p>

<h2>Step 5: Set up shipping</h2>
<p>Go to <strong>Settings → Shipping</strong> to configure how you'll deliver orders:</p>
<ul>
  <li><strong>Flat-rate shipping</strong> — charge a fixed fee per order (e.g. ₹49 standard, ₹149 express).</li>
  <li><strong>Free shipping above a threshold</strong> — e.g. free shipping on orders above ₹999. This boosts average order value.</li>
  <li><strong>Courier integration</strong> — connect Shiprocket, Delhivery, or BlueDart for automated label printing and tracking.</li>
  <li><strong>Pickup only</strong> — if you have a physical store, offer local pickup as a free option.</li>
</ul>

<h2>Step 6: Connect your custom domain (optional but recommended)</h2>
<p>Your store launches on a free subdomain like <code>yourstore.rapidstore.io</code>, but a custom domain (e.g. <code>www.yourstore.com</code>) looks more professional and builds trust.</p>
<ol>
  <li>Buy a domain from GoDaddy, Namecheap, or Google Domains.</li>
  <li>Go to <strong>Settings → Domains → Add Domain</strong> and enter your domain name.</li>
  <li>Copy the CNAME record shown and add it in your domain registrar's DNS settings.</li>
  <li>Click <strong>Verify</strong>. SSL is provisioned automatically — your store goes live on your domain within 48 hours.</li>
</ol>

<h2>Step 7: Preview and go live</h2>
<p>Click <strong>View Store</strong> from your dashboard to preview exactly what customers will see. Check that:</p>
<ul>
  <li>Your products, prices, and images look correct.</li>
  <li>The checkout flow works (place a test order using the test payment mode in Razorpay/Stripe).</li>
  <li>Your store name, logo, and contact email appear correctly.</li>
</ul>
<p>When you are happy, click <strong>Publish Store</strong> from the dashboard. Your store is now live and accepting orders.</p>

<h2>Step 8: Drive your first sales</h2>
<p>Once live, promote your store:</p>
<ul>
  <li><strong>Share the link</strong> on WhatsApp, Instagram, and Facebook. Rapid Commerce generates a shareable link and QR code from your dashboard.</li>
  <li><strong>Discount codes</strong> — create a launch offer (e.g. 10% off for the first 50 customers) from <strong>Marketing → Discount Codes</strong>.</li>
  <li><strong>Abandoned cart recovery</strong> — Rapid Commerce automatically emails customers who added products to their cart but didn't complete checkout. Enable it from <strong>Marketing → Abandoned Cart</strong>.</li>
  <li><strong>Google Shopping</strong> — sync your product catalogue to Google Shopping from <strong>Marketing → Google</strong> for free organic traffic.</li>
</ul>

<h2>Frequently asked questions about launching</h2>
<p><strong>How long does it take to launch?</strong> Most stores go live in under 30 minutes. Adding products and connecting payments are the two longest steps.</p>
<p><strong>Do I need a business registration?</strong> No, you can start selling as an individual. For GST invoicing and higher payment limits you should register your business, but it is not required on day one.</p>
<p><strong>Can I sell both physical and digital products?</strong> Yes. For digital products (e-books, templates, courses) Rapid Commerce delivers a secure download link automatically after payment.</p>
<p><strong>What if I already have a website?</strong> You can embed the Rapid Commerce checkout button or product widget on any existing website using a simple HTML snippet from <strong>Settings → Embed</strong>.</p>
<p><strong>Is there a transaction fee?</strong> On the Starter plan there is a 2% transaction fee on each sale. Upgrade to Pro (₹2,499/month) to remove it entirely.</p>`,
      ),

      // ── Article 2: Refund policy ─────────────────────────────────────
      art("Refund & Return Policy", "refund-policy", catPolicies,
        `<p>At <strong>Rapid Commerce</strong> we stand behind every purchase. If you are not completely satisfied, this policy explains exactly what you are entitled to and how to get it.</p>

<h2>30-day refund window</h2>
<p>You may request a full refund within <strong>30 days</strong> of your original purchase date. After 30 days, we are unable to issue a refund, but you may be eligible for store credit at our discretion.</p>

<h2>How to request a refund</h2>
<ol>
  <li>Contact our support team via live chat or email at <strong>support@rapidcommerce.io</strong>.</li>
  <li>Provide your <strong>order number</strong> (found in your confirmation email or under My Orders).</li>
  <li>Briefly describe the reason for your refund — this helps us improve our service.</li>
  <li>Our team will review your request within <strong>24 hours</strong> and confirm approval by email.</li>
  <li>For physical items, you will need to ship the item back in its original condition within <strong>7 days of approval</strong>. We will provide the return address in the approval email.</li>
  <li>Once we receive and inspect the return, we issue the refund. You'll get an email confirmation.</li>
</ol>

<h2>Refund timelines by payment method</h2>
<p>After we confirm your refund, the time it takes to reach you depends on your payment method:</p>
<ul>
  <li><strong>Credit / Debit card</strong> — 5 to 7 business days.</li>
  <li><strong>UPI / Net banking</strong> — 3 to 5 business days.</li>
  <li><strong>Paytm / Amazon Pay / wallet</strong> — 1 to 2 business days (credited back to your wallet).</li>
  <li><strong>Cash on Delivery orders</strong> — refunded as store credit or via NEFT bank transfer within 7 to 10 business days.</li>
  <li><strong>PayPal / Stripe (international)</strong> — 5 to 10 business days depending on your bank.</li>
</ul>
<p>For returns, the refund clock starts from the day we receive and inspect your item — not the day you ship it. For cancelled orders (before dispatch), the refund is initiated immediately after confirmation.</p>

<h2>Damaged, defective, or wrong items</h2>
<p>If you receive a damaged, defective, or incorrect item, we will make it right immediately:</p>
<ul>
  <li>Contact us within <strong>48 hours of delivery</strong> with a photo or video showing the issue.</li>
  <li>We will either send a replacement at no charge or issue a full refund — your choice.</li>
  <li>You do <strong>not</strong> need to return the item in these cases.</li>
</ul>

<h2>Non-refundable items</h2>
<p>The following cannot be refunded:</p>
<ul>
  <li><strong>Digital products</strong> that have already been downloaded or activated (e-books, software licences, course access).</li>
  <li><strong>Gift cards</strong> and store credit.</li>
  <li><strong>Items marked as Final Sale</strong> — these are clearly labelled on the product page before purchase.</li>
  <li><strong>Perishable goods</strong> (food, flowers, etc.) unless they arrived damaged or spoiled.</li>
  <li>Products returned after the 30-day window without prior approval.</li>
</ul>

<h2>Return shipping</h2>
<ul>
  <li>If the return is due to our error (wrong or damaged item), we cover the return shipping cost and provide a prepaid label.</li>
  <li>For all other returns (change of mind, wrong size ordered, etc.), the customer is responsible for return shipping charges.</li>
</ul>

<h2>Cancellations</h2>
<p>You can cancel an order that has <strong>not yet been dispatched</strong> from My Orders → Cancel. Refunds for cancelled orders are processed within <strong>3 to 5 business days</strong>. Once an order is dispatched you will need to follow the return process above instead.</p>

<h2>Contact us</h2>
<p>For any refund or return questions, reach out to us:</p>
<ul>
  <li>Live chat — available 24/7 on our website and in the Rapid Commerce app.</li>
  <li>Email — <strong>support@rapidcommerce.io</strong> (response within 4 hours on business days).</li>
  <li>Phone — <strong>+91 80 4567 8900</strong>, Monday to Friday, 9am to 6pm IST (Pro and Enterprise customers only).</li>
</ul>`,
      ),
    ]);

    // 5) One starter contact + two minimal conversations so inbox is not empty.
    const demoContact = newId();
    await db.insert(contacts).values([
      { id: demoContact, workspaceId: DEMO_WS, name: "Demo Customer", email: "demo@example.com", visitorToken: newId(), lastSeenAt: new Date() },
    ]);

    const mkConv = (
      contactId: string,
      channel: "chat" | "email",
      status: "open" | "snoozed" | "resolved",
      subject: string | null,
      minsAgo: number
    ) => {
      const id = newId();
      return {
        row: { id, workspaceId: DEMO_WS, contactId, channel, status, subject, lastMessageAt: new Date(Date.now() - minsAgo * 60_000) },
        id,
      };
    };

    const c1 = mkConv(demoContact, "chat", "open", null, 5);
    const c2 = mkConv(demoContact, "email", "open", "Question about my order", 30);
    await db.insert(conversations).values([c1.row, c2.row]);

    const msg = (convId: string, sender: "contact" | "agent", body: string, minsAgo: number) => ({
      id: newId(),
      conversationId: convId,
      workspaceId: DEMO_WS,
      senderType: sender,
      body,
      createdAt: new Date(Date.now() - minsAgo * 60_000),
    });

    await db.insert(messages).values([
      msg(c1.id, "contact", "Hi! I have a question about my recent order.", 6),
      msg(c2.id, "contact", "Hello, I'd like to know the status of my order.", 31),
    ]);

    return void res.json({
      ok: true,
      workspaceId: DEMO_WS,
      publicKey: DEMO_PUBLIC_KEY,
      demoUrl: "/demo",
    });
  } catch (err) {
    console.error("[seed]", err);
    return void res.status(500).json({ error: "seed failed" });
  }
});
