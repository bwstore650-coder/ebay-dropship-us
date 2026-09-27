import LegalPage, { legalMetadata } from "@/components/LegalPage";

export const generateMetadata = () => legalMetadata("refund");

export default function Page() {
  return <LegalPage doc="refund" />;
}
