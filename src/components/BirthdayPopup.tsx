import { useEffect, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Cake } from "lucide-react";

interface BirthdayPopupProps {
  dateOfBirth: string | null | undefined;
  firstName: string;
}

const BirthdayPopup = ({ dateOfBirth, firstName }: BirthdayPopupProps) => {
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!dateOfBirth) return;

    const today = new Date();
    const dob = new Date(dateOfBirth);
    if (today.getMonth() === dob.getMonth() && today.getDate() === dob.getDate()) {
      const dismissed = localStorage.getItem("birthday_popup_dismissed");
      if (dismissed) {
        const dismissedDate = new Date(parseInt(dismissed, 10));
        if (
          dismissedDate.getFullYear() === today.getFullYear() &&
          dismissedDate.getMonth() === today.getMonth() &&
          dismissedDate.getDate() === today.getDate()
        ) {
          return;
        }
      }
      setShow(true);
    }
  }, [dateOfBirth]);

  const dismiss = () => {
    setShow(false);
    localStorage.setItem("birthday_popup_dismissed", Date.now().toString());
  };

  return (
    <AnimatePresence>
      {show && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 backdrop-blur-sm p-4"
          onClick={dismiss}
        >
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            exit={{ scale: 0.8, opacity: 0 }}
            transition={{ type: "spring", damping: 20, stiffness: 300 }}
            className="relative bg-card rounded-2xl border border-border shadow-2xl p-8 max-w-sm w-full text-center"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={dismiss}
              className="absolute top-3 right-3 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X className="w-4 h-4" />
            </button>

            <div className="text-6xl mb-4">🎂</div>
            <h2 className="text-2xl font-display font-bold text-foreground">
              Happy Birthday, {firstName}! 🎉
            </h2>
            <p className="text-sm text-muted-foreground mt-2">
              Wishing you an amazing day! Thank you for being part of the Helpr community.
            </p>
            <div className="flex items-center justify-center gap-1 mt-4 text-primary">
              <Cake className="w-4 h-4" />
              <span className="text-xs font-medium">From the Helpr team with ❤️</span>
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};

export default BirthdayPopup;
