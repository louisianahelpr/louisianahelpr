import { useEffect, useState } from "react";
import { useParams, useNavigate, Link } from "react-router-dom";
import { ChevronDown, ChevronUp } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { ArrowLeft, MapPin, Star, Briefcase, Clock, Heart, HeartOff, Zap, CheckCircle, Mail, Phone, ClipboardList, Hammer } from "lucide-react";
import { computeBadges, HelperBadges } from "@/components/HelperBadges";
import { HelperPortfolio } from "@/components/HelperPortfolio";
import { RetainerAgreement } from "@/components/RetainerAgreement";
import { toast } from "sonner";
import type { Database } from "@/integrations/supabase/types";
import { usePageTitle } from "@/hooks/usePageTitle";

type Profile = Database["public"]["Tables"]["profiles"]["Row"];


          {/* Member since */}
          <p className="text-xs text-muted-foreground text-center">
            Member since {new Date(profile.created_at).toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
        </div>
      </main>
    </div>
  );
};

export default UserProfile;
