import { useNavigate } from "react-router-dom";
import CategoryBento from "@/components/landing/CategoryBento";

const CategorySection = () => {
  const navigate = useNavigate();

  const goToPostJob = async () => {
    const { supabase } = await import("@/integrations/supabase/client");
    const {
      data: { session },
    } = await supabase.auth.getSession();
    navigate(session?.user ? "/post-job" : "/signup");
  };

  return (
    <section className="pt-4 pb-4 sm:pt-6 sm:pb-5 lg:pt-8 lg:pb-7 px-5 sm:px-8 lg:px-12">
      <div className="container mx-auto max-w-6xl">
        <div className="mb-4 sm:mb-5 max-w-xl">
          <span className="text-display-eyebrow">Where Louisiana gets help</span>
          <h2 className="text-display-xl mt-2 text-balance">
            Browse by service.
          </h2>
        </div>
        <CategoryBento onSelect={goToPostJob} />
      </div>
    </section>
  );
};

export default CategorySection;
