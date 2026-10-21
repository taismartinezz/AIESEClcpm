"use client";

import { useState } from "react";
import PageHeader from "@/components/ui/PageHeader";
import { NeedsDatabase } from "@/components/ui/TeachingEmpty";
import { useProject } from "@/context/ProjectContext";
import { isSupabaseConfigured } from "@/lib/supabase";
import { isExec } from "@/lib/permissions";
import { useLcMembers } from "@/hooks/useLcMembers";
import { Tabs } from "@/components/lc/ui";
import RecruitmentTab from "@/components/members/RecruitmentTab";
import OnboardingTab, { MyOnboardingCard } from "@/components/members/OnboardingTab";
import ActivityTab from "@/components/members/ActivityTab";
import ImportWizard from "@/components/import/ImportWizard";

type Tab = "recruitment" | "onboarding" | "activity";

/** Talent Management: recruitment intake, onboarding, activity and term dates. */
export default function MembersPage() {
  const { projectId, userId, role, departments, departmentId, ledDepartmentIds, isLoading } = useProject();
  const exec = isExec(role);
  const { members, names } = useLcMembers(projectId);
  const [tab, setTab] = useState<Tab>("recruitment");
  const [importing, setImporting] = useState(false);
  const [version, setVersion] = useState(0);
  const looksAfter = role === "president" ? members : members.filter((m) => m.departmentId && ledDepartmentIds.includes(m.departmentId));

  return (
    <div className="flex flex-col h-full">
      <PageHeader title="People" subtitle={exec ? "Recruitment, onboarding and how your members are doing." : "Your onboarding in the LC."} />
      <div className="flex-1 overflow-auto" style={{ padding: "16px clamp(16px, 3vw, 28px)", maxWidth: 1200, width: "100%" }}>
        {isLoading ? (
          <div className="animate-pulse" style={{ height: 200, borderRadius: 10, backgroundColor: "var(--color-dimmed-bg)" }} />
        ) : !isSupabaseConfigured || !projectId || !userId ? (
          <NeedsDatabase what="Members">Recruitment, onboarding and activity signals for Talent Management.</NeedsDatabase>
        ) : !exec ? (
          <div style={{ maxWidth: 520 }}>
            <MyOnboardingCard projectId={projectId} userId={userId} departmentId={departmentId} />
            <p style={{ fontSize: 13, color: "var(--color-secondary)" }}>When your onboarding is complete this page stays quiet. Recruitment and activity are for the exec board.</p>
          </div>
        ) : (
          <>
            <Tabs value={tab} onChange={setTab} tabs={[
              { id: "recruitment", label: "Recruitment" },
              { id: "onboarding", label: "Onboarding" },
              { id: "activity", label: "Activity & terms" },
            ]} />
            <div style={{ marginTop: 16 }}>
              {tab === "recruitment" && <RecruitmentTab projectId={projectId} userId={userId} departments={departments} onImport={() => setImporting(true)} version={version} />}
              {tab === "onboarding" && <OnboardingTab projectId={projectId} members={looksAfter} departments={departments} canEditSteps={exec} />}
              {tab === "activity" && <ActivityTab projectId={projectId} names={names} departments={departments} />}
            </div>
          </>
        )}
      </div>
      {importing && projectId && (
        <ImportWizard target="recruits" projectId={projectId} products={[]}
          context={{ departments, roster: members, defaultDepartmentId: departmentId }}
          onClose={() => setImporting(false)} onImported={() => setVersion((v) => v + 1)} />
      )}
    </div>
  );
}
