import LegalPage, { legalMetadata } from "@/components/LegalPage";

export const generateMetadata = () => legalMetadata("terms");

export default function Page() {
  return <LegalPage doc="terms" />;
}
