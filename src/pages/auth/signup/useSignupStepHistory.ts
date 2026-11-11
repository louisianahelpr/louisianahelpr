import { useEffect, useRef } from "react";
import { useLocation, type NavigateFunction } from "react-router-dom";
import { signupStepFromHistory } from "./signupHelpers";

/**
 * F260n (audit 11-10): sign-up step 2 is its own history entry, so Back returns to step 1 (fields kept in state,
 * not retyped) and Forward returns to step 2. The entry's state says which step; popstate lands here through
 * location.key. The first render keeps Signup's dev-only ?step seed. Pulled out of Signup.tsx (size ratchet).
 */
export function useSignupStepHistory(navigate: NavigateFunction, setStep: (step: 1 | 2) => void, beforeBack: () => void) {
  const routerLocation = useLocation();
  const firstLocationKey = useRef(routerLocation.key);
  useEffect(() => {
    if (routerLocation.key === firstLocationKey.current) return;
    setStep(signupStepFromHistory(routerLocation.state));
  }, [routerLocation.key, routerLocation.state, setStep]);
  const goToStep2 = () => {
    navigate({ pathname: routerLocation.pathname, search: routerLocation.search }, { state: { ...((routerLocation.state as object | null) ?? {}), step: 2 } });
    setStep(2);
  };
  const backToStep1 = () => {
    beforeBack();
    // L005: pops only the step-2 entry goToStep2 pushed itself; a fresh /signup?step=2 (dev seed) just sets step 1.
    if (signupStepFromHistory(routerLocation.state) === 2) navigate(-1);
    else setStep(1);
  };
  return { goToStep2, backToStep1 };
}
