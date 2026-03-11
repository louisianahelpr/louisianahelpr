import { Link } from "react-router-dom";
import { ArrowLeft, FileText, Shield, DollarSign, Users, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";

const TermsOfService = () => {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen bg-background pb-20 md:pb-0">
      <header className="border-b border-border bg-background/80 backdrop-blur-md sticky top-0 z-40">
        <div className="container mx-auto flex items-center h-16 px-4 gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate(-1)}>
            <ArrowLeft className="w-4 h-4" />
          </Button>
          <Link to="/" className="text-2xl font-display font-bold text-primary">Helpr</Link>
        </div>
      </header>

      <main className="container mx-auto px-4 py-8">
        <div className="max-w-2xl mx-auto space-y-8">
          <div>
            <h1 className="text-3xl font-display font-bold text-foreground">Terms of Service</h1>
            <p className="text-sm text-muted-foreground mt-2">Last updated: March 2026</p>
          </div>

          {/* Terms of Service */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <FileText className="w-5 h-5 text-primary" /> Terms of Use
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>By accessing or using the Helpr platform ("Service"), you agree to be bound by these Terms of Service. If you do not agree, do not use the Service.</p>
              <p><strong className="text-foreground">Eligibility:</strong> You must be at least 18 years old to use Helpr. By creating an account, you represent that you meet this requirement.</p>
              <p><strong className="text-foreground">Account Responsibility:</strong> You are responsible for maintaining the security of your account credentials and all activity that occurs under your account.</p>
              <p><strong className="text-foreground">Task Agreements:</strong> When you accept a task or hire a helper, you enter a binding agreement to complete the work as described and to release payment upon satisfactory completion.</p>
              <p><strong className="text-foreground">Prohibited Conduct:</strong> You may not use Helpr for illegal activities, harassment, fraud, discrimination, or any conduct that violates the rights of others.</p>
              <p><strong className="text-foreground">Account Termination:</strong> Helpr reserves the right to suspend or terminate accounts that violate these terms, at our sole discretion.</p>
              <p><strong className="text-foreground">Intellectual Property:</strong> All content, branding, and technology on the Helpr platform are owned by Helpr. You may not copy, modify, or distribute any part of the Service without permission.</p>
              <p><strong className="text-foreground">Limitation of Liability:</strong> Helpr acts as a marketplace connecting customers and helpers. We are not responsible for the quality, safety, or legality of tasks performed through the platform.</p>
            </div>
          </section>

          {/* Privacy Policy */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Shield className="w-5 h-5 text-primary" /> Privacy Policy
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>Your privacy is important to us. This policy explains how we collect, use, and protect your personal information.</p>
              <p><strong className="text-foreground">Data Collection:</strong> We collect information you provide (name, email, phone, location) and usage data to improve the platform experience.</p>
              <p><strong className="text-foreground">Data Usage:</strong> Your data is used to match you with tasks, process payments, communicate updates, and improve our services.</p>
              <p><strong className="text-foreground">Data Sharing:</strong> We share limited information (first name, reviews, ratings) with other users to facilitate trust. Payment data is securely handled by our payment processor. We never sell your personal information to third parties.</p>
              <p><strong className="text-foreground">Data Retention:</strong> Your data is retained while your account is active. You can request deletion at any time by contacting support.</p>
              <p><strong className="text-foreground">Cookies:</strong> We use cookies and similar technologies for authentication, analytics, and improving your experience.</p>
            </div>
          </section>

          {/* Payment & Refund */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <DollarSign className="w-5 h-5 text-primary" /> Payment & Refund Policy
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p><strong className="text-foreground">Escrow System:</strong> All payments are held in escrow until both parties confirm the job is complete.</p>
              <p><strong className="text-foreground">Platform Fee:</strong> Helpr charges a platform fee on each transaction. The fee percentage is visible before payment is made.</p>
              <p><strong className="text-foreground">Auto-Release:</strong> If a job is not confirmed as complete within 72 hours after one party marks it done, payment is automatically released to the helper.</p>
              <p><strong className="text-foreground">Revisions:</strong> Posters can request revisions before approving completion. Helpers are notified and given a chance to address concerns.</p>
              <p><strong className="text-foreground">Refunds:</strong> Refunds are evaluated on a case-by-case basis. Contact support to initiate a dispute.</p>
            </div>
          </section>

          {/* Community Guidelines */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <Users className="w-5 h-5 text-primary" /> Community Guidelines
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>Helpr is built on trust. We expect all users to follow these guidelines to maintain a safe and positive community.</p>
              <p><strong className="text-foreground">Respect:</strong> Treat all users with respect and professionalism, regardless of background.</p>
              <p><strong className="text-foreground">Honesty:</strong> Provide accurate information in your profile and job descriptions. Misrepresentation may result in account suspension.</p>
              <p><strong className="text-foreground">Safety:</strong> Never share personal information like home addresses or financial details through the messaging system. Meet in safe, public locations when possible.</p>
              <p><strong className="text-foreground">Timeliness:</strong> Show up on time and communicate promptly. If you can't make a commitment, cancel with advance notice.</p>
              <p><strong className="text-foreground">Quality:</strong> Complete tasks to the standard described in the job posting. Take before/after photos when applicable.</p>
              <p><strong className="text-foreground">Reporting:</strong> Report any suspicious, inappropriate, or unsafe behavior using the report feature. All reports are reviewed by our team.</p>
            </div>
          </section>

          {/* Violations */}
          <section className="space-y-4">
            <h2 className="text-xl font-display font-semibold text-foreground flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-primary" /> Violations & Enforcement
            </h2>
            <div className="rounded-xl border border-border bg-card p-5 space-y-3 text-sm text-muted-foreground">
              <p>Violations of these terms or guidelines may result in the following actions:</p>
              <ul className="list-disc list-inside space-y-1">
                <li>Warning notification</li>
                <li>Temporary account suspension</li>
                <li>Permanent account ban</li>
                <li>Withholding of pending payments</li>
                <li>Reporting to law enforcement (for illegal activity)</li>
              </ul>
              <p>The severity of the action depends on the nature and frequency of the violation.</p>
            </div>
          </section>

          <p className="text-xs text-muted-foreground text-center pb-8">
            Questions about these terms? <Link to="/support" className="text-primary hover:underline">Contact support</Link>
          </p>
        </div>
      </main>
    </div>
  );
};

export default TermsOfService;
