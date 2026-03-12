import { motion } from "framer-motion";
import { Heart, Users, Sparkles, HandHeart } from "lucide-react";

const appreciations = [
  {
    icon: <HandHeart className="w-6 h-6" />,
    title: "To Our Helpers",
    message: "You show up, get it done, and make someone's day easier. Your hard work doesn't go unnoticed — thank you for being the backbone of this community.",
  },
  {
    icon: <Users className="w-6 h-6" />,
    title: "To Our Customers",
    message: "By trusting your neighbors with your tasks, you're building something bigger than a to-do list — you're building community. Thank you for believing in us.",
  },
  {
    icon: <Sparkles className="w-6 h-6" />,
    title: "To Everyone",
    message: "Every job posted, every task completed, every kind review — it all matters. You make Helpr what it is. We see you, and we appreciate you.",
  },
];

const CommunityLoveSection = () => (
  <section className="py-20 px-4 bg-gradient-to-b from-primary/5 via-background to-background">
    <div className="container mx-auto max-w-4xl">
      <motion.div
        initial={{ opacity: 0, y: 20 }}
        whileInView={{ opacity: 1, y: 0 }}
        viewport={{ once: true }}
        transition={{ duration: 0.5 }}
        className="text-center mb-12"
      >
        <div className="inline-flex items-center gap-2 px-4 py-1.5 rounded-full bg-primary/10 text-primary text-sm font-medium mb-4">
          <Heart className="w-4 h-4 fill-primary" /> Community Love
        </div>
        <h2 className="text-3xl md:text-4xl font-display font-bold text-foreground">
          Thank You for Being Part of Helpr
        </h2>
        <p className="text-muted-foreground mt-3 max-w-xl mx-auto">
          This platform exists because of people like you. Every task, every connection, every helping hand — it all starts with you.
        </p>
      </motion.div>

      <div className="grid md:grid-cols-3 gap-6">
        {appreciations.map((item, i) => (
          <motion.div
            key={item.title}
            initial={{ opacity: 0, y: 20 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.4, delay: i * 0.15 }}
            className="rounded-2xl border border-primary/10 bg-card p-6 text-center space-y-3 hover:border-primary/30 transition-colors"
          >
            <div className="w-12 h-12 rounded-full bg-primary/10 text-primary flex items-center justify-center mx-auto">
              {item.icon}
            </div>
            <h3 className="font-display font-bold text-foreground">{item.title}</h3>
            <p className="text-sm text-muted-foreground leading-relaxed">{item.message}</p>
          </motion.div>
        ))}
      </div>
    </div>
  </section>
);

export default CommunityLoveSection;
