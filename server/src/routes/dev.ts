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

    // 4) KB: 3 categories + 9 published articles with rich policy content.
    const catGetting = newId();
    const catPolicies = newId();
    const catBilling  = newId();
    await db.insert(kbCategories).values([
      { id: catGetting,  workspaceId: DEMO_WS, name: "Getting Started", slug: "getting-started", position: 0 },
      { id: catPolicies, workspaceId: DEMO_WS, name: "Policies & Company", slug: "policies", position: 1 },
      { id: catBilling,  workspaceId: DEMO_WS, name: "Billing", slug: "billing", position: 2 },
    ]);

    const art = (
      title: string, slug: string, categoryId: string,
      bodyHtml: string, bodyText: string,
    ) => ({ id: newId(), workspaceId: DEMO_WS, categoryId, title, slug, bodyHtml, bodyText, status: "published" as const });

    await db.insert(kbArticles).values([
      // ── Getting Started ──────────────────────────────────────────────
      art(
        "Getting started with Rapid Commerce",
        "getting-started",
        catGetting,
        `<p>Welcome to <strong>Rapid Commerce</strong> — the fastest way to launch and scale your online store.</p>
<h2>Step 1: Create your account</h2>
<p>Sign up at rapidcommerce.io with your email or Google account. No credit card required for the 14-day free trial.</p>
<h2>Step 2: Add your products</h2>
<p>Go to <strong>Products → Add Product</strong>. Upload images, set your price, and publish. Your storefront updates instantly.</p>
<h2>Step 3: Connect a payment method</h2>
<p>We support Stripe, Razorpay, and PayPal. Go to <strong>Settings → Payments</strong> to connect your preferred gateway.</p>
<h2>Step 4: Share your store link</h2>
<p>Your default store URL is <code>yourname.rapidstore.io</code>. You can connect a custom domain anytime from Settings → Domains.</p>`,
        "Welcome to Rapid Commerce. Sign up, add products, connect payments, share your store link. 14-day free trial no credit card required.",
      ),

      art(
        "How to connect a custom domain",
        "custom-domain",
        catGetting,
        `<p>You can serve your Rapid Commerce store from your own domain (e.g. <strong>shop.yourcompany.com</strong>).</p>
<h2>Steps</h2>
<ol>
  <li>Go to <strong>Settings → Domains</strong> and click <em>Add Domain</em>.</li>
  <li>Enter your domain name (e.g. <code>shop.yourcompany.com</code>).</li>
  <li>Add the CNAME record shown to your DNS provider pointing to <code>stores.rapidcommerce.io</code>.</li>
  <li>Click <strong>Verify</strong>. DNS changes can take up to 48 hours to propagate.</li>
</ol>
<p>Once verified, an SSL certificate is automatically provisioned. Your store will be live at your custom domain within minutes.</p>`,
        "Connect a custom domain to your Rapid Commerce store. Add domain in settings, add CNAME DNS record, click verify. SSL certificate auto-provisioned.",
      ),

      // ── Policies ─────────────────────────────────────────────────────
      art(
        "Refund & Return Policy",
        "refund-policy",
        catPolicies,
        `<p>At <strong>Rapid Commerce</strong> we want you to be completely satisfied with your purchase. If you are not happy, we make returns simple.</p>
<h2>30-day refund window</h2>
<p>You may request a full refund within <strong>30 days</strong> of your original purchase date. After 30 days, refunds are not available, but you may be eligible for store credit at our discretion.</p>
<h2>How to request a refund</h2>
<ol>
  <li>Contact our support team via chat or email with your <strong>order number</strong>.</li>
  <li>Tell us the reason for the refund — this helps us improve.</li>
  <li>If the item is physical, ship it back to us in its original condition within 7 days of approval.</li>
  <li>Refunds are processed back to your original payment method within <strong>5–7 business days</strong> of us receiving the return.</li>
</ol>
<h2>Non-refundable items</h2>
<ul>
  <li>Digital products that have been downloaded or activated.</li>
  <li>Gift cards.</li>
  <li>Items marked as <em>Final Sale</em>.</li>
</ul>
<h2>Damaged or incorrect orders</h2>
<p>If you received a damaged or wrong item, contact us within <strong>48 hours</strong> of delivery with a photo. We will send a replacement or full refund at no cost to you.</p>`,
        "Refund policy: 30-day refund window from purchase date. Full refund within 30 days. Physical items must be returned in original condition within 7 days of approval. Refund processed in 5 to 7 business days. Non-refundable: digital downloads, gift cards, final sale items. Damaged or wrong items contact within 48 hours.",
      ),

      art(
        "Shipping & Delivery",
        "shipping-delivery",
        catPolicies,
        `<p>We ship across India and internationally. Delivery times depend on your location and the shipping method selected at checkout.</p>
<h2>Domestic shipping (India)</h2>
<ul>
  <li><strong>Standard (3–5 business days)</strong> — ₹49 or free on orders above ₹999.</li>
  <li><strong>Express (1–2 business days)</strong> — ₹149.</li>
  <li><strong>Same-day delivery</strong> — available in select metro cities, ₹299.</li>
</ul>
<h2>International shipping</h2>
<ul>
  <li><strong>Standard International (7–14 business days)</strong> — calculated at checkout.</li>
  <li><strong>Express International (3–5 business days)</strong> — calculated at checkout.</li>
</ul>
<h2>Tracking your order</h2>
<p>Once your order ships, you will receive a tracking number by email and SMS. You can also check order status in your account under <strong>My Orders</strong>.</p>
<h2>Delays</h2>
<p>During peak seasons (festivals, sales) please allow 1–2 extra business days. If your order has not arrived after the maximum estimated time, contact our support team with your order number.</p>`,
        "Shipping and delivery: Standard 3 to 5 business days free above 999 rupees. Express 1 to 2 business days 149 rupees. Same-day in metro cities 299 rupees. International 7 to 14 days. Tracking number sent by email and SMS. Contact support if order delayed beyond estimated time.",
      ),

      art(
        "Privacy Policy",
        "privacy-policy",
        catPolicies,
        `<p><strong>Rapid Commerce</strong> is committed to protecting your personal data.</p>
<h2>What we collect</h2>
<ul>
  <li>Name, email, and phone number when you create an account or place an order.</li>
  <li>Shipping address for order fulfilment.</li>
  <li>Payment details — processed securely by our payment partners (we never store card numbers).</li>
  <li>Browsing behaviour on our platform to improve recommendations.</li>
</ul>
<h2>How we use your data</h2>
<p>We use your data to process orders, provide customer support, send transactional emails, and (with your consent) send promotional offers. We do not sell your data to third parties.</p>
<h2>Data retention</h2>
<p>Your account data is retained for as long as your account is active. You may request deletion of your account and associated data at any time by contacting support.</p>
<h2>Contact</h2>
<p>For any privacy concerns, email us at <strong>privacy@rapidcommerce.io</strong>.</p>`,
        "Privacy policy: Rapid Commerce collects name email phone shipping address. Payment details processed by payment partners not stored. Data used for orders support emails promotions with consent. Data not sold to third parties. Account data retained while active. Request deletion by contacting support.",
      ),

      art(
        "About Rapid Commerce",
        "about",
        catPolicies,
        `<p><strong>Rapid Commerce</strong> is an all-in-one e-commerce platform that helps entrepreneurs and businesses launch their online store in minutes — no coding required.</p>
<h2>Our mission</h2>
<p>We believe every business deserves a world-class online store, regardless of size or budget. Rapid Commerce handles the tech so you can focus on your products and customers.</p>
<h2>What we offer</h2>
<ul>
  <li>Hosted storefronts with custom domains.</li>
  <li>Integrated payments (Stripe, Razorpay, PayPal).</li>
  <li>Inventory management and order tracking.</li>
  <li>Built-in marketing tools: discount codes, abandoned cart recovery, email campaigns.</li>
  <li>24/7 customer support via chat and email.</li>
</ul>
<h2>Contact us</h2>
<p>Support: <strong>support@rapidcommerce.io</strong><br/>
Sales: <strong>sales@rapidcommerce.io</strong><br/>
Headquarters: Bangalore, India.</p>`,
        "About Rapid Commerce: all-in-one e-commerce platform launch online store in minutes no coding. Custom domains integrated payments Stripe Razorpay PayPal inventory management order tracking marketing tools discount codes abandoned cart email campaigns 24/7 support.",
      ),

      // ── Billing ──────────────────────────────────────────────────────
      art(
        "Understanding your invoice",
        "understanding-invoice",
        catBilling,
        `<p>Invoices are generated on the 1st of each month for the previous billing period and emailed to the account owner.</p>
<h2>What's on your invoice</h2>
<ul>
  <li><strong>Plan charge</strong> — your monthly or annual subscription fee.</li>
  <li><strong>Transaction fees</strong> — 0% on Pro and Enterprise; 2% on Starter.</li>
  <li><strong>Add-ons</strong> — any extra team seats or premium features.</li>
</ul>
<h2>Downloading invoices</h2>
<p>Go to <strong>Settings → Billing → Invoice History</strong> to download PDF copies of all past invoices.</p>
<h2>Failed payments</h2>
<p>If a payment fails, we retry over 3 days and notify you by email. If the payment is still not cleared after 7 days, your store will be paused until the invoice is settled.</p>`,
        "Invoices generated 1st of each month. Plan charge transaction fees 0% on Pro and Enterprise 2% on Starter. Download invoices from Settings Billing Invoice History. Failed payments retried over 3 days store paused after 7 days.",
      ),

      art(
        "Upgrading or downgrading your plan",
        "change-plan",
        catBilling,
        `<p>You can change your plan at any time from <strong>Settings → Billing → Change Plan</strong>.</p>
<h2>Upgrading</h2>
<p>When you upgrade, you are charged the prorated difference immediately and your new features are available right away.</p>
<h2>Downgrading</h2>
<p>When you downgrade, the change takes effect at the start of your next billing cycle. You keep your current plan's features until then.</p>
<h2>Annual plans</h2>
<p>Annual plans are billed upfront and save you 20% compared to monthly billing. If you cancel an annual plan within 30 days of renewal, you are eligible for a prorated refund.</p>`,
        "Change plan at Settings Billing Change Plan. Upgrading: charged prorated difference immediately features available right away. Downgrading: takes effect next billing cycle. Annual plans billed upfront save 20%. Cancel annual plan within 30 days of renewal eligible for prorated refund.",
      ),

      art(
        "Cancelling your subscription",
        "cancel-subscription",
        catBilling,
        `<p>You can cancel your Rapid Commerce subscription at any time — no questions asked.</p>
<h2>How to cancel</h2>
<ol>
  <li>Go to <strong>Settings → Billing</strong>.</li>
  <li>Click <strong>Cancel Subscription</strong> at the bottom of the page.</li>
  <li>Choose whether to cancel immediately or at the end of your current billing period.</li>
</ol>
<h2>What happens after cancellation</h2>
<ul>
  <li>Your store goes offline at the end of the paid period.</li>
  <li>Your data is retained for <strong>30 days</strong> after cancellation so you can re-activate if you change your mind.</li>
  <li>After 30 days, all store data is permanently deleted.</li>
</ul>
<h2>Refunds on cancellation</h2>
<p>Monthly plans are not refunded on cancellation — you keep access until the end of the paid period. Annual plans cancelled within 30 days of renewal receive a prorated refund.</p>`,
        "Cancel subscription at Settings Billing Cancel Subscription. Cancel immediately or end of billing period. Store goes offline end of paid period. Data retained 30 days after cancellation then permanently deleted. Monthly plans not refunded on cancellation. Annual plans cancelled within 30 days of renewal get prorated refund.",
      ),
    ]);

    // 5) Contacts + conversations (2 chat, 2 email, one long for AI summary).
    const jane = newId();
    const bob = newId();
    await db.insert(contacts).values([
      { id: jane, workspaceId: DEMO_WS, name: "Jane Rivera", email: "jane@example.com", visitorToken: newId(), lastSeenAt: new Date() },
      { id: bob, workspaceId: DEMO_WS, name: "Bob Chen", email: "bob@example.com", lastSeenAt: new Date() },
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
        row: {
          id,
          workspaceId: DEMO_WS,
          contactId,
          channel,
          status,
          subject,
          lastMessageAt: new Date(Date.now() - minsAgo * 60_000),
        },
        id,
      };
    };

    const c1 = mkConv(jane, "chat", "open", null, 3);
    const c2 = mkConv(bob,  "email", "open", "Refund request – Order #10284", 20);
    const c3 = mkConv(jane, "chat", "open", null, 45);
    const c4 = mkConv(bob,  "email", "snoozed", "Invoice question", 60);
    const c5 = mkConv(jane, "chat", "resolved", null, 180);
    await db.insert(conversations).values([c1.row, c2.row, c3.row, c4.row, c5.row]);
    await db
      .update(conversations)
      .set({ snoozedUntil: new Date(Date.now() + 3600_000) })
      .where(eq(conversations.id, c4.id));

    const msg = (
      convId: string,
      sender: "contact" | "agent",
      body: string,
      minsAgo: number
    ) => ({
      id: newId(),
      conversationId: convId,
      workspaceId: DEMO_WS,
      senderType: sender,
      body,
      createdAt: new Date(Date.now() - minsAgo * 60_000),
    });

    await db.insert(messages).values([
      // c1 — refund chat (open, AI draft should pull from refund policy)
      msg(c1.id, "contact", "Hi! I bought a product 10 days ago and I want to return it. Is that possible?", 5),
      msg(c1.id, "contact", "How many days do I have to get a refund?", 3),

      // c2 — refund email thread (long, good for AI summary demo)
      msg(c2.id, "contact", "Hi, I placed order #10284 on the 5th and received a damaged item. The box was crushed and the product inside is broken.", 22),
      msg(c2.id, "agent", "Hi Bob, so sorry to hear that! Could you share a photo of the damage so we can process this for you right away?", 20),
      msg(c2.id, "contact", "Sure, I've attached a photo. The corner of the device is completely cracked.", 18),
      msg(c2.id, "agent", "Thank you for the photo. I've escalated this to our fulfilment team. You'll receive either a replacement or a full refund — whichever you prefer.", 16),
      msg(c2.id, "contact", "I'd prefer a refund please. How long will it take to get the money back?", 14),
      msg(c2.id, "contact", "Also, do I need to ship the damaged item back?", 13),

      // c3 — shipping question chat (AI draft should pull from shipping policy)
      msg(c3.id, "contact", "Hey, I ordered yesterday but haven't received any tracking info yet. When will my order arrive?", 47),
      msg(c3.id, "agent", "Hi Jane! Let me check your order status.", 46),
      msg(c3.id, "contact", "I chose standard shipping. Is there a way to upgrade to express?", 45),

      // c4 — billing snoozed
      msg(c4.id, "contact", "I was charged twice this month — once on the 1st and once on the 15th. Can you explain?", 62),
      msg(c4.id, "agent", "Hi Bob, let me pull up your billing history. I'll get back to you shortly.", 60),

      // c5 — resolved
      msg(c5.id, "contact", "How do I cancel my subscription?", 185),
      msg(c5.id, "agent", "You can cancel anytime from Settings → Billing → Cancel Subscription. You keep access until the end of your paid period.", 183),
      msg(c5.id, "contact", "Perfect, found it. Thank you!", 180),
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
