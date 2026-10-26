import "../src/index.css";
import { useState } from "react";
import { createRoot } from "react-dom/client";
import { DatePickerField } from "../src/components/DatePickerField";
import { LogisticsSection } from "../src/components/postjob/LogisticsSection";
const mode = new URLSearchParams(location.search).get("mode") ?? "alone";
const bump = () => { (window as any).calls = ((window as any).calls || 0) + 1; };
function Logistics() {
  const [d, setD] = useState(""); const [t, setT] = useState(""); const [street, setStreet] = useState("123 Main St"); const [city, setCity] = useState("Lafayette");
  const [st, setSt] = useState("LA"); const [zip, setZip] = useState("70501"); const [flex, setFlex] = useState(false); const [sr, setSr] = useState("");
  const [rec, setRec] = useState(false); const [rd, setRd] = useState<number[]>([]); const [rw, setRw] = useState(4); const [split, setSplit] = useState(false);
  const [grp, setGrp] = useState(false); const [hn, setHn] = useState("2");
  return (<><div id="out">value=[{d}]</div><form onSubmit={(e) => e.preventDefault()}>
    <LogisticsSection stepNumber={2} streetAddress={street} setStreetAddress={setStreet} city={city} setCity={setCity} addrState={st} setAddrState={setSt} zipCode={zip} setZipCode={setZip}
      dateNeeded={d} setDateNeeded={(v) => { bump(); setD(v); }} startTime={t} setStartTime={setT} isFlexibleSchedule={flex} setIsFlexibleSchedule={setFlex}
      specialRequirements={sr} setSpecialRequirements={setSr} isRecurring={rec} setIsRecurring={setRec} recurrenceDays={rd} setRecurrenceDays={setRd} recurrenceWeeks={rw} setRecurrenceWeeks={setRw}
      seriesSplitOk={split} setSeriesSplitOk={setSplit} isGroupJob={grp} setIsGroupJob={setGrp} helpersNeeded={hn} setHelpersNeeded={setHn} budgetNum={50} logisticsComplete={false} category="cleaning" />
  </form></>);
}
function Alone() { const [v, setV] = useState(""); return (<><div id="out">value=[{v}]</div><DatePickerField id="date" inline labelledBy="x" value={v} onChange={(x) => { bump(); setV(x); }} min="2026-10-26" /></>); }
function H() {
  if (mode === "scroller") return (<div style={{ height: "100dvh", overflow: "hidden", display: "flex", flexDirection: "column" }}>
    <div data-app-page-scroll="" className="page-measure h-full overflow-y-auto px-3 pb-safe-nav" style={{ flex: 1, minHeight: 0 }}><Logistics /></div></div>);
  return <div style={{ padding: 20 }}>{mode === "logistics" ? <Logistics /> : <Alone />}</div>;
}
createRoot(document.getElementById("r")!).render(<H />);
