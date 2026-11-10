/**
 * The three steps of hiring, in ONE place (L014, landing audit 11-09: the /hire town pages said them in other words
 * than the landing's "How a job works"). Read by HowItWorksSection (the "I need help" side) and HireTownPage. Its own
 * tiny module so a town page carries no landing code. Copy true today: see HowItWorksSection's notes.
 */
export const HIRE_STEPS = [
  { title: "Post what you need", desc: "Describe the job and set your price." },
  { title: "Pick your Helpr", desc: "See who applied and chat before you hire." },
  { title: "Pay when it's done", desc: "Your money is held safely until you approve the work." },
] as const;
