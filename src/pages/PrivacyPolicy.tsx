import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Shield, Database, Eye, Lock, Trash2, Cookie } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useEffect } from "react";

const PrivacyPolicy = () => {
  const navigate = useNavigate();

  useEffect(() => {
    document.title = "Privacy Policy — Helpr";
    return () => { document.title = "Helpr"; };
  }, []);

  return (
    <div className="min-h-screen bg-background pb-20">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Privacy Policy</h1>
            <p className="text-sm text-muted-foreground mt-2">Last updated: March 2026</p>
          </div>

          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Database className="w-5 h-5 text-primary" /> Information We Collect
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Account Information:</strong> Name, email address, phone number, date of birth, and profile photo when you create an account.</p>
              <p><strong className="text-foreground">Identity Verification:</strong> Government-issued ID documents for helpers to ensure platform safety. These are stored securely and accessed only during verification.</p>
              <p><strong className="text-foreground">Location Data:</strong> Address and GPS coordinates when you post or check in to jobs, used for matching and proximity verification.</p>
              <p><strong className="text-foreground">Payment Information:</strong> Payment details are processed securely by Stripe. Helpr does not store your full credit card number.</p>
              <p><strong className="text-foreground">Usage Data:</strong> Device information, IP address, browser type, and interaction data to improve platform performance.</p>
              <p><strong className="text-foreground">Communications:</strong> Messages sent through the in-app chat system are stored to facilitate job coordination and dispute resolution.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Eye className="w-5 h-5 text-primary" /> How We Use Your Information
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Service Delivery:</strong> To match you with tasks, process payments, and facilitate communication between customers and helpers.</p>
              <p><strong className="text-foreground">Safety & Trust:</strong> To verify identities, prevent fraud, enforce community guidelines, and resolve disputes.</p>
              <p><strong className="text-foreground">Notifications:</strong> To send job updates, payment confirmations, and important account alerts via push notifications and email.</p>
              <p><strong className="text-foreground">Platform Improvement:</strong> To analyze usage patterns, fix bugs, and develop new features that serve our Louisiana community.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Information Sharing
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">With Other Users:</strong> Your first name, profile photo, ratings, and reviews are visible to other users. Full contact details are only shared after a job is confirmed.</p>
              <p><strong className="text-foreground">Payment Processors:</strong> Stripe processes all payments securely under their own privacy policy.</p>
              <p><strong className="text-foreground">Legal Requirements:</strong> We may disclose information when required by law, court order, or to protect the safety of our users.</p>
              <p><strong className="text-foreground">No Selling:</strong> We never sell your personal information to third parties for advertising or marketing purposes.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Lock className="w-5 h-5 text-primary" /> Data Security
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>We use industry-standard security measures including encryption in transit (TLS) and at rest, secure authentication, and role-based access controls to protect your data.</p>
              <p>ID documents are stored in private, encrypted storage buckets accessible only to authorized verification personnel.</p>
              <p>In-app messages are monitored to prevent sharing of personal contact information to keep transactions safe on the platform.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Trash2 className="w-5 h-5 text-primary" /> Your Rights
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Access:</strong> You can view all your personal data through your profile settings.</p>
              <p><strong className="text-foreground">Correction:</strong> You can update your profile information at any time.</p>
              <p><strong className="text-foreground">Deletion:</strong> You can request complete account and data deletion by contacting support. We will process requests within 30 days.</p>
              <p><strong className="text-foreground">Data Portability:</strong> You can request a copy of your data in a machine-readable format.</p>
            </div>
          </section>

          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Cookie className="w-5 h-5 text-primary" /> Cookies & Tracking
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>We use essential cookies for authentication and session management. We use analytics cookies to understand how users interact with the platform.</p>
              <p>You can control cookie preferences through your browser settings, though disabling essential cookies may affect platform functionality.</p>
            </div>
          </section>

          <p className="text-xs text-muted-foreground text-center pb-8">
            Questions about your privacy? <Link to="/support" className="text-primary hover:underline">Contact support</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default PrivacyPolicy;
