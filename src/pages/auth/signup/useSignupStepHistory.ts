import { useEffect } from "react";
import { useLocation, useNavigate, useNavigationType } from "react-router-dom";
import { signupStepFromHistory } from "./signupHelpers";

/**
 * F260n (audit 11-10): step 2 is its own history entry, so Back returns to step 1 (fields kept, not retyped) and
 * Forward returns to step 2. Only a POP (Back/Forward) syncs the step from the entry's state: a replace or push made
 * elsewhere (the signed-in bounce, the pending page) never resets the wizard. The first render keeps the dev-only
 * ?step seed (history key "default").
 */
export function useSignupStepHistory(setStep: (step: 1 | 2) => void, onBack: () => void) {
  const navigate = useNavigate();
  const routerLocation = useLocation();
  const navigationType = useNavigationType();
  useEffect(() => {
    if (navigationType === "POP" && routerLocation.key !== "default") setStep(signupStepFromHistory(routerLocation.state));
  }, [navigationType, routerLocation.key, routerLocation.state, setStep]);
  const goToStep2 = () => {
    navigate({ pathname: routerLocation.pathname, search: routerLocation.search }, { state: { ...((routerLocation.state as object | null) ?? {}), step: 2 } });
    setStep(2);
  };
  const backToStep1 = () => {
    onBack();
    if (signupStepFromHistory(routerLocation.state) === 2) navigate(-1);
    else setStep(1);
  };
  return { goToStep2, backToStep1 };
}
