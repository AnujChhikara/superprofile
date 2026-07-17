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

    // 4) KB: 5 categories + 18 published articles.
    const catGetting  = newId();
    const catOrders   = newId();
    const catReturns  = newId();
    const catBilling  = newId();
    const catCompany  = newId();
    await db.insert(kbCategories).values([
      { id: catGetting,  workspaceId: DEMO_WS, name: "Getting Started",    slug: "getting-started", position: 0 },
      { id: catOrders,   workspaceId: DEMO_WS, name: "Orders & Shipping",  slug: "orders-shipping",  position: 1 },
      { id: catReturns,  workspaceId: DEMO_WS, name: "Returns & Refunds",  slug: "returns-refunds",  position: 2 },
      { id: catBilling,  workspaceId: DEMO_WS, name: "Billing & Plans",    slug: "billing-plans",    position: 3 },
      { id: catCompany,  workspaceId: DEMO_WS, name: "Policies & Company", slug: "policies-company", position: 4 },
    ]);

    const art = (
      title: string, slug: string, categoryId: string,
      bodyHtml: string,
    ) => ({ id: newId(), workspaceId: DEMO_WS, categoryId, title, slug, bodyHtml, bodyText: articleText(bodyHtml), status: "published" as const });

    await db.insert(kbArticles).values([
      // ── Getting Started ──────────────────────────────────────────────
      art("Getting started with Rapid Commerce", "getting-started", catGetting,
        `<p>Welcome to <strong>Rapid Commerce</strong> — the fastest way to launch and scale your online store.</p>
<h2>Step 1: Create your account</h2>
<p>Sign up at rapidcommerce.io with your email or Google account. No credit card required for the 14-day free trial.</p>
<h2>Step 2: Add your products</h2>
<p>Go to <strong>Products → Add Product</strong>. Upload images, set your price, and publish. Your storefront updates instantly.</p>
<h2>Step 3: Connect a payment method</h2>
<p>We support Stripe, Razorpay, and PayPal. Go to <strong>Settings → Payments</strong> to connect your preferred gateway.</p>
<h2>Step 4: Share your store link</h2>
<p>Your default store URL is <code>yourname.rapidstore.io</code>. You can connect a custom domain anytime from Settings → Domains.</p>`,
      ),

      art("How to reset your password", "reset-password", catGetting,
        `<p>If you have forgotten your password or want to change it, follow these steps.</p>
<h2>Forgot your password?</h2>
<ol>
  <li>Go to the Rapid Commerce login page.</li>
  <li>Click <strong>Forgot password?</strong> below the sign-in button.</li>
  <li>Enter your registered email address and click <strong>Send reset link</strong>.</li>
  <li>Check your inbox for an email from <em>no-reply@rapidcommerce.io</em>.</li>
  <li>Click the link in the email — it is valid for <strong>1 hour</strong>.</li>
  <li>Enter and confirm your new password.</li>
</ol>
<h2>Change your password while logged in</h2>
<p>Go to <strong>Account → Security → Change Password</strong>. You will need to enter your current password to confirm the change.</p>
<p>If you did not receive the reset email, check your spam folder or contact support at <strong>support@rapidcommerce.io</strong>.</p>`,
      ),

      art("How to add and manage team members", "team-members", catGetting,
        `<p>You can invite teammates to help manage your Rapid Commerce store. Each member gets their own login.</p>
<h2>Inviting a team member</h2>
<ol>
  <li>Go to <strong>Settings → Team</strong>.</li>
  <li>Click <strong>Invite Member</strong> and enter their email address.</li>
  <li>Choose a role: <em>Admin</em> (full access) or <em>Agent</em> (manage orders and support only).</li>
  <li>Click <strong>Send Invite</strong>. They will receive an email with a link to join.</li>
</ol>
<h2>Removing a team member</h2>
<p>Go to <strong>Settings → Team</strong>, find the member, and click <strong>Remove</strong>. Their access is revoked immediately.</p>
<h2>Plan limits</h2>
<ul>
  <li><strong>Starter</strong> — 1 team member (owner only).</li>
  <li><strong>Pro</strong> — up to 5 team members.</li>
  <li><strong>Enterprise</strong> — unlimited team members.</li>
</ul>`,
      ),

      art("How to connect a custom domain", "custom-domain", catGetting,
        `<p>Serve your store from your own domain (e.g. <strong>shop.yourcompany.com</strong>) instead of the default rapidstore.io address.</p>
<h2>Steps</h2>
<ol>
  <li>Go to <strong>Settings → Domains</strong> and click <em>Add Domain</em>.</li>
  <li>Enter your domain (e.g. <code>shop.yourcompany.com</code>).</li>
  <li>Add the CNAME record shown to your DNS provider pointing to <code>stores.rapidcommerce.io</code>.</li>
  <li>Click <strong>Verify</strong>. DNS changes can take up to 48 hours to propagate.</li>
</ol>
<p>Once verified, an SSL certificate is provisioned automatically and your store is live on your domain.</p>`,
      ),

      // ── Orders & Shipping ────────────────────────────────────────────
      art("How to track your order", "track-order", catOrders,
        `<p>Once your order has been shipped, you can track it in real time.</p>
<h2>Via email</h2>
<p>You will receive a shipping confirmation email with a <strong>tracking number</strong> and a direct link to the courier's tracking page.</p>
<h2>Via your account</h2>
<ol>
  <li>Log in to rapidcommerce.io.</li>
  <li>Go to <strong>My Orders</strong>.</li>
  <li>Click on your order and select <strong>Track Shipment</strong>.</li>
</ol>
<h2>Tracking not updating?</h2>
<p>Tracking information can take up to <strong>24 hours</strong> to appear after the shipment label is created. If it has been more than 48 hours with no update, contact our support team with your order number.</p>`,
      ),

      art("Shipping & Delivery", "shipping-delivery", catOrders,
        `<p>We ship across India and internationally. Delivery times depend on your location and shipping method selected at checkout.</p>
<h2>Domestic shipping (India)</h2>
<ul>
  <li><strong>Standard (3–5 business days)</strong> — ₹49, or free on orders above ₹999.</li>
  <li><strong>Express (1–2 business days)</strong> — ₹149.</li>
  <li><strong>Same-day delivery</strong> — available in select metro cities (Mumbai, Delhi, Bangalore, Hyderabad), ₹299.</li>
</ul>
<h2>International shipping</h2>
<ul>
  <li><strong>Standard International (7–14 business days)</strong> — calculated at checkout based on destination.</li>
  <li><strong>Express International (3–5 business days)</strong> — calculated at checkout.</li>
</ul>
<h2>Delays</h2>
<p>During peak seasons (Diwali, Christmas, New Year sales) please allow 1–2 extra business days. We will notify you by email if your order is significantly delayed.</p>`,
      ),

      art("How to edit or cancel an order", "edit-cancel-order", catOrders,
        `<p>You can edit or cancel an order only <strong>before it has been dispatched</strong>.</p>
<h2>Cancelling an order</h2>
<ol>
  <li>Log in and go to <strong>My Orders</strong>.</li>
  <li>Find your order and click <strong>Cancel Order</strong>.</li>
  <li>Select a reason and confirm.</li>
</ol>
<p>If the cancel button is greyed out, the order has already been dispatched and you will need to initiate a return instead.</p>
<h2>Editing an order</h2>
<p>Address changes, size/colour changes, or quantity adjustments must be requested via support <strong>within 1 hour</strong> of placing the order. Contact us at <strong>support@rapidcommerce.io</strong> or via live chat immediately.</p>
<h2>Refund on cancellation</h2>
<p>Cancelled order refunds are processed within <strong>3–5 business days</strong> to your original payment method.</p>`,
      ),

      art("Payment methods accepted", "payment-methods", catOrders,
        `<p>Rapid Commerce accepts a wide range of payment methods to make checkout easy for your customers.</p>
<h2>Supported payment methods</h2>
<ul>
  <li><strong>Credit & Debit cards</strong> — Visa, Mastercard, RuPay, American Express.</li>
  <li><strong>UPI</strong> — Google Pay, PhonePe, Paytm, BHIM UPI.</li>
  <li><strong>Net banking</strong> — all major Indian banks.</li>
  <li><strong>Wallets</strong> — Paytm, Amazon Pay, Mobikwik.</li>
  <li><strong>Buy Now Pay Later</strong> — ZestMoney, LazyPay, Simpl.</li>
  <li><strong>International</strong> — PayPal, Stripe (for USD/EUR transactions).</li>
  <li><strong>Cash on Delivery (COD)</strong> — available on select pin codes within India.</li>
</ul>
<h2>Payment security</h2>
<p>All transactions are encrypted with 256-bit SSL. We are PCI-DSS compliant. We never store your card details on our servers.</p>`,
      ),

      // ── Returns & Refunds ────────────────────────────────────────────
      art("Refund & Return Policy", "refund-policy", catReturns,
        `<p>At Rapid Commerce we want you to be completely satisfied. If something is not right, we make returns simple.</p>
<h2>30-day refund window</h2>
<p>You may request a full refund within <strong>30 days</strong> of your original purchase date. After 30 days, refunds are not available but you may be eligible for store credit at our discretion.</p>
<h2>How to request a refund</h2>
<ol>
  <li>Contact our support team via chat or email with your <strong>order number</strong>.</li>
  <li>Tell us the reason — this helps us improve.</li>
  <li>For physical items, ship them back in original condition within <strong>7 days of approval</strong>.</li>
  <li>Refunds are credited to your original payment method within <strong>5–7 business days</strong> of us receiving the return.</li>
</ol>
<h2>Non-refundable items</h2>
<ul>
  <li>Digital products that have been downloaded or activated.</li>
  <li>Gift cards and store credit.</li>
  <li>Items marked as <em>Final Sale</em>.</li>
  <li>Perishable goods.</li>
</ul>
<h2>Damaged or wrong items</h2>
<p>If you received a damaged or incorrect item, contact us within <strong>48 hours of delivery</strong> with a photo. We will send a replacement or issue a full refund at no cost to you — no need to return the item.</p>`,
      ),

      art("How long does a refund take?", "refund-timeline", catReturns,
        `<p>Refund timelines depend on your payment method and when we receive the returned item.</p>
<h2>Timelines by payment method</h2>
<ul>
  <li><strong>Credit / Debit card</strong> — 5–7 business days after we process the refund.</li>
  <li><strong>UPI / Net banking</strong> — 3–5 business days.</li>
  <li><strong>Wallets (Paytm, Amazon Pay)</strong> — 1–2 business days (credited back to the wallet).</li>
  <li><strong>Cash on Delivery orders</strong> — refunded as store credit or bank transfer (NEFT) within 7–10 business days.</li>
  <li><strong>PayPal / Stripe (international)</strong> — 5–10 business days depending on your bank.</li>
</ul>
<h2>When does the clock start?</h2>
<p>For returns, the refund timeline starts from the day we receive and inspect your returned item — not from the day you ship it.</p>
<p>For cancelled orders (before dispatch), the timeline starts immediately once the cancellation is confirmed.</p>
<h2>Still waiting?</h2>
<p>If your refund has not arrived after the maximum timeframe, contact us at <strong>support@rapidcommerce.io</strong> with your order number and we will investigate immediately.</p>`,
      ),

      art("How to return a product", "return-process", catReturns,
        `<p>Returning a product is straightforward. Follow the steps below to initiate a return.</p>
<h2>Eligibility</h2>
<ul>
  <li>Item must be returned within <strong>30 days</strong> of purchase.</li>
  <li>Item must be unused, unwashed, and in original packaging with all tags attached.</li>
  <li>Include the original invoice or packing slip.</li>
</ul>
<h2>Return steps</h2>
<ol>
  <li>Contact support via chat or email at <strong>support@rapidcommerce.io</strong> with your order number and reason for return.</li>
  <li>Our team will approve the return and email you a <strong>Return Merchandise Authorisation (RMA)</strong> number within 24 hours.</li>
  <li>Pack the item securely and write the RMA number on the outside of the package.</li>
  <li>Ship to: <strong>Rapid Commerce Returns, 14 MG Road, Bangalore 560001, India</strong>.</li>
  <li>Share the courier tracking number with our support team.</li>
</ol>
<h2>Return shipping cost</h2>
<p>If the return is due to our error (wrong or damaged item), we cover the return shipping cost. For all other returns, the customer is responsible for return shipping charges.</p>`,
      ),

      // ── Billing & Plans ──────────────────────────────────────────────
      art("Pricing plans overview", "pricing-plans", catBilling,
        `<p>Rapid Commerce offers three plans to suit businesses of all sizes.</p>
<h2>Starter — Free for 14 days, then ₹999/month</h2>
<ul>
  <li>1 store, up to 100 products.</li>
  <li>Standard checkout, UPI and card payments.</li>
  <li>2% transaction fee on all sales.</li>
  <li>Email support only.</li>
</ul>
<h2>Pro — ₹2,499/month (or ₹23,990/year — save 20%)</h2>
<ul>
  <li>1 store, unlimited products.</li>
  <li>All payment methods including BNPL and COD.</li>
  <li>0% transaction fee.</li>
  <li>Up to 5 team members.</li>
  <li>Custom domain, discount codes, abandoned cart recovery.</li>
  <li>Priority chat and email support.</li>
</ul>
<h2>Enterprise — Custom pricing</h2>
<ul>
  <li>Multiple stores and unlimited products.</li>
  <li>Dedicated account manager.</li>
  <li>SLA-backed 24/7 support.</li>
  <li>Custom integrations and API access.</li>
</ul>
<p>All plans include a <strong>14-day free trial</strong>. No credit card required to start.</p>`,
      ),

      art("Understanding your invoice", "understanding-invoice", catBilling,
        `<p>Invoices are generated on the <strong>1st of each month</strong> for the previous billing period and emailed to the account owner.</p>
<h2>What's on your invoice</h2>
<ul>
  <li><strong>Plan charge</strong> — your monthly or annual subscription fee.</li>
  <li><strong>Transaction fees</strong> — 0% on Pro and Enterprise; 2% on Starter (itemised by order).</li>
  <li><strong>Add-ons</strong> — extra team seats, premium themes, or other features.</li>
  <li><strong>Taxes</strong> — GST at 18% applies to all charges for Indian businesses.</li>
</ul>
<h2>Downloading invoices</h2>
<p>Go to <strong>Settings → Billing → Invoice History</strong> to download PDF copies of all past invoices. GST-compliant invoices are available for all Indian accounts.</p>
<h2>Failed payments</h2>
<p>If a payment fails, we retry over 3 days. If still unpaid after 7 days, your store is paused until the invoice is settled. You will receive email reminders at each step.</p>`,
      ),

      art("Upgrading or downgrading your plan", "change-plan", catBilling,
        `<p>You can change your plan at any time from <strong>Settings → Billing → Change Plan</strong>.</p>
<h2>Upgrading</h2>
<p>When you upgrade, you are charged the prorated difference immediately and your new features are available right away.</p>
<h2>Downgrading</h2>
<p>When you downgrade, the change takes effect at the start of your next billing cycle. You keep your current plan's features until then.</p>
<h2>Annual plans</h2>
<p>Annual plans are billed upfront and save you <strong>20%</strong> compared to monthly billing. If you cancel an annual plan within 30 days of renewal, you are eligible for a prorated refund for unused months.</p>`,
      ),

      art("Cancelling your subscription", "cancel-subscription", catBilling,
        `<p>You can cancel your Rapid Commerce subscription at any time — no questions asked.</p>
<h2>How to cancel</h2>
<ol>
  <li>Go to <strong>Settings → Billing</strong>.</li>
  <li>Click <strong>Cancel Subscription</strong> at the bottom of the page.</li>
  <li>Choose to cancel immediately or at the end of your billing period.</li>
</ol>
<h2>What happens after cancellation</h2>
<ul>
  <li>Your store goes offline at the end of the paid period.</li>
  <li>Your data is kept for <strong>30 days</strong> — you can re-activate anytime in that window.</li>
  <li>After 30 days, all data is permanently and irreversibly deleted.</li>
</ul>
<h2>Refunds on cancellation</h2>
<p>Monthly plans: no refund — you keep access until the end of the current period.<br/>
Annual plans: if cancelled within 30 days of the renewal date, you receive a prorated refund for unused months.</p>`,
      ),

      // ── Policies & Company ───────────────────────────────────────────
      art("About Rapid Commerce", "about", catCompany,
        `<p><strong>Rapid Commerce</strong> is an all-in-one e-commerce platform built for Indian entrepreneurs and businesses. Launch your online store in minutes — no coding or design skills required.</p>
<h2>Our mission</h2>
<p>We believe every business, from a home baker in Jaipur to a manufacturer in Surat, deserves a world-class online presence. Rapid Commerce handles the technology so you can focus entirely on your products and customers.</p>
<h2>Founded</h2>
<p>Rapid Commerce was founded in 2021 and is headquartered in <strong>Bangalore, India</strong>. We are a team of 80+ engineers, designers, and support specialists.</p>
<h2>What we offer</h2>
<ul>
  <li>Hosted storefronts with free SSL and custom domains.</li>
  <li>Integrated Indian and international payments.</li>
  <li>Inventory management, order tracking, and fulfilment tools.</li>
  <li>Built-in marketing: discount codes, abandoned cart recovery, email campaigns.</li>
  <li>24/7 customer support via live chat and email.</li>
</ul>
<h2>Contact</h2>
<p>Support: <strong>support@rapidcommerce.io</strong><br/>
Sales: <strong>sales@rapidcommerce.io</strong><br/>
Office: 14 MG Road, Bangalore 560001, India.<br/>
Phone: +91 80 4567 8900 (Mon–Fri, 9am–6pm IST).</p>`,
      ),

      art("Privacy Policy", "privacy-policy", catCompany,
        `<p>Rapid Commerce is committed to protecting your personal data and being transparent about how we use it.</p>
<h2>What we collect</h2>
<ul>
  <li>Name, email address, and phone number when you register.</li>
  <li>Shipping address for order fulfilment.</li>
  <li>Payment information — processed securely by our payment partners; we never store card numbers.</li>
  <li>Browsing and purchase behaviour to improve product recommendations.</li>
  <li>Device and IP information for security and fraud prevention.</li>
</ul>
<h2>How we use your data</h2>
<p>We use your data to process orders, provide customer support, send order confirmations and shipping updates, and (with your explicit consent) send promotional offers. We do not sell or share your personal data with third parties for marketing purposes.</p>
<h2>Your rights</h2>
<ul>
  <li>Access your data at any time from <strong>Account → Privacy</strong>.</li>
  <li>Request correction of inaccurate data.</li>
  <li>Request deletion — contact <strong>privacy@rapidcommerce.io</strong>. We process deletion requests within 30 days.</li>
  <li>Opt out of marketing emails via the unsubscribe link in any email.</li>
</ul>
<h2>Data retention</h2>
<p>Active account data is retained while your account is open. After account deletion, data is purged within 30 days except where required by law (e.g. GST records are kept for 8 years).</p>`,
      ),

      art("Terms of Service", "terms-of-service", catCompany,
        `<p>By using Rapid Commerce you agree to these Terms of Service. Please read them carefully.</p>
<h2>Use of the platform</h2>
<p>You may use Rapid Commerce only for lawful e-commerce purposes. You must not sell prohibited items including counterfeit goods, illegal substances, weapons, or content that violates intellectual property rights.</p>
<h2>Account responsibility</h2>
<p>You are responsible for keeping your login credentials secure. Rapid Commerce is not liable for losses caused by unauthorised account access due to your negligence.</p>
<h2>Fees and payments</h2>
<p>Subscription fees are billed in advance. Transaction fees are deducted from your payouts. All fees are non-refundable except as stated in our Refund Policy.</p>
<h2>Intellectual property</h2>
<p>You retain ownership of all content you upload to your store. By uploading, you grant Rapid Commerce a licence to display and deliver that content to your customers.</p>
<h2>Termination</h2>
<p>We may suspend or terminate your account if you violate these terms. You may close your account at any time from Settings → Billing.</p>
<h2>Governing law</h2>
<p>These terms are governed by the laws of India. Any disputes are subject to the jurisdiction of courts in Bangalore, Karnataka.</p>`,
      ),

      art("Contact & Support Hours", "contact-support", catCompany,
        `<p>Our support team is here to help you — reach us through any of the channels below.</p>
<h2>Live chat</h2>
<p>Available <strong>24/7</strong> on the Rapid Commerce dashboard and on the chat widget on your store. Average response time: <strong>under 2 minutes</strong>.</p>
<h2>Email support</h2>
<p>Email us at <strong>support@rapidcommerce.io</strong>. We respond within <strong>4 hours</strong> on business days (Mon–Fri, 9am–9pm IST) and within 12 hours on weekends.</p>
<h2>Phone support</h2>
<p>Phone support is available for <strong>Pro and Enterprise</strong> plan customers.<br/>
Number: <strong>+91 80 4567 8900</strong><br/>
Hours: Monday–Friday, 9am–6pm IST.</p>
<h2>Community forum</h2>
<p>Join thousands of Rapid Commerce sellers on our community forum at <strong>community.rapidcommerce.io</strong> for tips, templates, and peer support.</p>
<h2>Status page</h2>
<p>Check real-time platform uptime and incident reports at <strong>status.rapidcommerce.io</strong>.</p>`,
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
