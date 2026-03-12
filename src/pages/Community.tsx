import { Link } from "react-router-dom";
import { motion } from "framer-motion";
import { Heart, Users, Star, HandHeart, Sparkles, ArrowLeft, Gift, Shield, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import Footer from "@/components/Footer";
import { usePageTitle } from "@/hooks/usePageTitle";

const values = [
  {
    icon: <HandHeart className="w-6 h-6" />,
    title: "Neighbors Helping Neighbors",
    desc: "Helpr isn't just a marketplace — it's a movement. Every task completed strengthens the bond between people in our community.",
  },
  {
    icon: <Shield className="w-6 h-6" />,
    title: "Trust & Safety First",
    desc: "We verify every helpr and protect every transaction so you can focus on what matters — getting things done and helping others.",
  },
  {
    icon: <Star className="w-6 h-6" />,
    title: "Everyone Has Value",
    desc: "Whether you're posting your first task or completing your hundredth job, you matter here. Your skills, your time, your trust — it all counts.",
  },
  {
    icon: <Zap className="w-6 h-6" />,
    title: "Opportunity for All",
    desc: "We believe everyone deserves the chance to earn, grow, and be recognized for their hard work. Helpr is built to make that happen.",
  },
];

const thankYouMessages = [
  {
    to: "Helpers",
    emoji: "🛠️",
    message: "You are the heart of Helpr. Every lawn mowed, every box moved, every errand run — you make life easier for your neighbors. Your dedication, reliability, and skill don't go unnoticed. We are grateful for every single one of you.",
  },
  {
    to: "Customers",
    emoji: "🏠",
    message: "By posting a task on Helpr, you're not just getting something done — you're creating an opportunity for someone in your community. You're trusting your neighbors, supporting local talent, and making Louisiana a better place to live.",
  },
  {
    to: "New Members",
    emoji: "👋",
    message: "Welcome to the family! Whether you're here to find help or lend a hand, you've joined a community that cares. Take your time, explore, and know that we're here to support you every step of the way.",
  },
  {
    to: "Long-Time Members",
    emoji: "💎",
    message: "You've been with us through it all — the early days, the growing pains, and the wins. Your loyalty and feedback have shaped Helpr into what it is today. Thank you for believing in us.",
  },
];

const Community = () => {
  usePageTitle("Community — Helpr");

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-border/50 bg-background/80 backdrop-blur-xl">
        <div className="container mx-auto flex items-center h-16 px-4 gap-3">
          <Link to="/" className="text-xl font-display font-bold text-primary">Helpr</Link>
          <Button variant="ghost" size="icon" asChild>
            <Link to="/"><ArrowLeft className="w-4 h-4" /></Link>
          </Button>
        </div>
      </header>

      {/* Hero */}
      <section className="py-16 px-4 bg-gradient-to-b from-primary/8 to-background">
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5 }}>
            <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-6">
              <Heart className="w-4 h-4 fill-primary" /> Our Community
            </div>
            <h1 className="text-4xl md:text-5xl font-display font-bold text-foreground leading-tight">
              Built by People.<br />Powered by Heart.
            </h1>
            <p className="text-lg text-muted-foreground mt-4 max-w-xl mx-auto">
              Helpr exists because of people like you. This page is our way of saying thank you — to every helpr, every customer, and every person who believes in the power of community.
            </p>
          </motion.div>
        </div>
      </section>

      {/* Our Values */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-4xl">
          <h2 className="text-2xl font-display font-bold text-foreground text-center mb-10">What We Believe In</h2>
          <div className="grid sm:grid-cols-2 gap-6">
            {values.map((v, i) => (
              <motion.div
                key={v.title}
                initial={{ opacity: 0, y: 16 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="rounded-2xl border border-border bg-card p-6 space-y-3"
              >
                <div className="w-10 h-10 rounded-xl bg-primary/10 text-primary flex items-center justify-center">
                  {v.icon}
                </div>
                <h3 className="font-display font-bold text-foreground">{v.title}</h3>
                <p className="text-sm text-muted-foreground leading-relaxed">{v.desc}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Thank You Messages */}
      <section className="py-16 px-4 bg-gradient-to-b from-primary/5 to-background">
        <div className="container mx-auto max-w-3xl">
          <h2 className="text-2xl font-display font-bold text-foreground text-center mb-3">A Special Thank You</h2>
          <p className="text-muted-foreground text-center mb-10">To every person who makes this community possible</p>
          <div className="space-y-6">
            {thankYouMessages.map((msg, i) => (
              <motion.div
                key={msg.to}
                initial={{ opacity: 0, x: i % 2 === 0 ? -20 : 20 }}
                whileInView={{ opacity: 1, x: 0 }}
                viewport={{ once: true }}
                transition={{ duration: 0.4, delay: i * 0.1 }}
                className="rounded-2xl border border-primary/10 bg-card p-6 space-y-2"
              >
                <div className="flex items-center gap-2">
                  <span className="text-2xl">{msg.emoji}</span>
                  <h3 className="font-display font-bold text-foreground">To Our {msg.to}</h3>
                </div>
                <p className="text-sm text-muted-foreground leading-relaxed">{msg.message}</p>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      {/* Community Stats Placeholder */}
      <section className="py-16 px-4">
        <div className="container mx-auto max-w-3xl text-center">
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            whileInView={{ opacity: 1, scale: 1 }}
            viewport={{ once: true }}
            className="rounded-2xl border-2 border-primary/20 bg-gradient-to-br from-primary/5 to-accent/5 p-8 space-y-4"
          >
            <Sparkles className="w-8 h-8 text-primary mx-auto" />
            <h2 className="text-2xl font-display font-bold text-foreground">You're Part of Something Special</h2>
            <p className="text-muted-foreground max-w-md mx-auto">
              Every job posted, every task completed, and every review left makes Louisiana a little bit better. We couldn't do this without you.
            </p>
            <div className="flex flex-col sm:flex-row gap-3 justify-center pt-2">
              <Button asChild>
                <Link to="/signup"><Users className="w-4 h-4 mr-2" /> Join the Community</Link>
              </Button>
              <Button variant="outline" asChild>
                <Link to="/dashboard"><Gift className="w-4 h-4 mr-2" /> Browse Tasks</Link>
              </Button>
            </div>
          </motion.div>
        </div>
      </section>

      <Footer />
    </div>
  );
};

export default Community;
