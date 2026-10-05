import { redirect } from "next/navigation";

// Communities are listed on the Cohorts & Communities page.
export default function CommunitiesIndex() {
  redirect("/cohorts#communities");
}
