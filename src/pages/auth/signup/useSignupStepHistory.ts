import { useEffect, useRef } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { KEEP_PAGE } from "@/lib/keepPage";
import { signupStepFromHistory } from "./signupHelpers";

/**
 * F260n (audit 11-10): step 2 is its own history entry, so Back returns to step 1 (fields kept, not retyped) and
 * Forward returns to step 2. Only a POP (Back/Forward) syncs the step from the entry's state: a replace or push made
 * elsewhere (the signed-in bounce, the pending page) never resets the wizard. The first render keeps the dev-only
 * ?step seed, and a reload stays on step 1 (the password is never kept). The step-2 entry carries KEEP_PAGE, so the
 * route wrapper keeps this page mounted across it (src/lib/keepPage.ts; it remounted and lost the password, 11-10).
 * The first entry of a cold load has key "default", so the first render is told apart by the key it saw, not by
 * "default" (Back to that entry left step 2 showing, 11-10).
 */
export function useSignupStepHistory(setStep: (step: 1 | 2) => void, onBack: () => void) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const navigationType = useNavigationType();
  const seenKey = useRef(routerLocation.key);
  useEffect(() => {
    if (routerLocation.key === seenKey.current) return;
    seenKey.current = routerLocation.key;
    if (navigationType === "POP") setStep(signupStepFromHistory(routerLocation.state));
  }, [navigationType, routerLocation.key, routerLocation.state, setStep]);
  const goToStep2 = () => {
    navigate({ pathname: routerLocation.pathname, search: routerLocation.search }, { state: { ...((routerLocation.state as object | null) ?? {}), step: 2, [KEEP_PAGE]: true } });
    setStep(2);
  };
  const backToStep1 = () => {
    onBack();
    if (signupStepFromHistory(routerLocation.state) === 2) navigate(-1);
    else setStep(1);
  };
  return { goToStep2, backToStep1 };
}
