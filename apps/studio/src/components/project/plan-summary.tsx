import { useTranslations } from 'next-intl';

import type { PlanClaim, PlanOutcome } from '@/lib/runs/run-contract';

/**
 * The working plan, as a finished run carries it: the Plan Critic's verdict, the materials list,
 * the assessment, the stages, and the self-check card.
 *
 * - **Materials come first** (FR-607): they are what the artist has to act on before starting.
 * - **Every claim shows its evidence class in words**, never by colour alone, so the artist can
 *   tell a measured fact from a cited lesson from an artistic choice they are free to overrule.
 * - **What the analysis set aside is shown with its reason** (FR-406). A measurement too weak to
 *   rest a plan on is an abstention the artist is told about, not a silent gap.
 * - **Open defects are shown, not hidden** (FR-704). A plan that shipped with caution says what
 *   the caution is, and a revised plan says what the first review found (FR-705).
 *
 * The plan's prose is the agents' own, in English; the page says so, as the routing summary does.
 */
interface PlanSummaryProps {
  outcome: PlanOutcome;
}

const ClaimList = ({ claims }: { claims: PlanClaim[] }) => {
  const tp = useTranslations('project.plan');
  const tt = useTranslations('project.tools');

  if (claims.length === 0) {
    return <p className="text-sm text-muted-foreground">{tp('restsOnNothing')}</p>;
  }

  const basis = (claim: PlanClaim) => {
    const { evidence } = claim;
    switch (evidence.kind) {
      case 'measured':
        return tp('measuredBy', {
          tool: tt.has(evidence.tool) ? tt(evidence.tool) : evidence.tool,
        });
      case 'cited':
        return tp('citedFrom', { institution: evidence.institution });
      case 'chosen':
        return tp('chosenBecause', {
          reason: evidence.reason,
          alternative: evidence.rejected_alternative,
        });
    }
  };

  return (
    <ul className="flex flex-col gap-1 text-sm">
      {claims.map((claim, index) => (
        <li key={`${claim.source ?? 'chosen'}-${index}`}>
          <span className="font-medium">{tp(`evidence.${claim.evidence.kind}`)}:</span> {claim.text}{' '}
          <span className="text-muted-foreground">— {basis(claim)}</span>
        </li>
      ))}
    </ul>
  );
};

const DefectList = ({ defects }: { defects: PlanOutcome['verdicts'][number]['defects'] }) => {
  const tp = useTranslations('project.plan');
  return (
    <ul className="flex flex-col gap-1 text-sm">
      {defects.map((defect, index) => (
        <li key={`${defect.category}-${defect.location ?? 'plan'}-${index}`}>
          <span className="font-medium">{tp(`defect.${defect.category}`)}:</span> {defect.detail}
        </li>
      ))}
    </ul>
  );
};

export const PlanSummary = ({ outcome }: PlanSummaryProps) => {
  const tp = useTranslations('project.plan');
  const tt = useTranslations('project.tools');
  const { plan, verdicts } = outcome;
  const { set_aside: setAside } = outcome.findings;
  const final = verdicts[verdicts.length - 1];
  const first = verdicts.length > 1 ? verdicts[0] : null;
  const itemName = new Map(plan.materials.map((item) => [item.item_id, item.specification]));
  const total = plan.stages.reduce((sum, stage) => sum + stage.minutes, 0);

  return (
    <section aria-labelledby="plan-heading" className="flex flex-col gap-6">
      <h2 id="plan-heading" className="text-lg font-semibold">
        {tp('title')}
      </h2>

      <section aria-labelledby="verdict-heading" className="flex flex-col gap-2">
        <h3 id="verdict-heading" className="text-base font-medium">
          {tp('verdictTitle')}: {tp(`verdict.${final.verdict}`)}
        </h3>
        <p className="text-sm">{final.summary}</p>
        {final.defects.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tp('noIssues')}</p>
        ) : (
          <>
            <h4 className="text-sm font-medium">{tp('openIssues')}</h4>
            <DefectList defects={final.defects} />
          </>
        )}
        {first ? (
          <details className="text-sm">
            <summary className="cursor-pointer">{tp('revised')}</summary>
            <div className="mt-2 flex flex-col gap-1">
              <p className="font-medium">{tp('firstReview')}</p>
              <p>{first.summary}</p>
              <DefectList defects={first.defects} />
            </div>
          </details>
        ) : null}
      </section>

      <section aria-labelledby="materials-heading" className="flex flex-col gap-2">
        <h3 id="materials-heading" className="text-base font-medium">
          {tp('materialsTitle')}
        </h3>
        {plan.materials.length === 0 ? (
          <p className="text-sm text-muted-foreground">{tp('noMaterials')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {plan.materials.map((item) => (
              <li key={item.item_id} className="flex flex-col gap-1">
                <span className="text-sm">
                  <span className="font-medium">{tp(`category.${item.category}`)}:</span>{' '}
                  {item.specification}
                </span>
                <ClaimList claims={[item.claim]} />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="assessment-heading" className="flex flex-col gap-2">
        <h3 id="assessment-heading" className="text-base font-medium">
          {tp('assessmentTitle')}: {tp(`suitability.${plan.assessment.suitability}`)}
        </h3>
        <ClaimList claims={plan.assessment.claims} />
      </section>

      {setAside.length > 0 ? (
        <section aria-labelledby="set-aside-heading" className="flex flex-col gap-2">
          <h3 id="set-aside-heading" className="text-base font-medium">
            {tp('setAsideTitle')}
          </h3>
          <p className="text-sm text-muted-foreground">{tp('setAsideIntro')}</p>
          <ul className="flex flex-col gap-1 text-sm">
            {setAside.map((entry) => (
              <li key={entry.finding_id}>
                <span className="font-medium">
                  {tt.has(entry.finding_id) ? tt(entry.finding_id) : entry.finding_id}:
                </span>{' '}
                {entry.reason}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section aria-labelledby="stages-heading" className="flex flex-col gap-2">
        <h3 id="stages-heading" className="text-base font-medium">
          {tp('stagesTitle')}{' '}
          <span className="text-sm font-normal text-muted-foreground">
            ({tp('totalMinutes', { minutes: total })})
          </span>
        </h3>
        <ol className="flex flex-col gap-4">
          {plan.stages.map((stage) => (
            <li key={stage.stage_id} className="flex flex-col gap-1 rounded-md border p-3">
              <h4 className="text-sm font-medium">
                {stage.title}{' '}
                <span className="font-normal text-muted-foreground">
                  — {tp('minutes', { minutes: stage.minutes })}
                </span>
              </h4>
              <dl className="grid gap-1 text-sm sm:grid-cols-[auto_1fr] sm:gap-x-3">
                <dt className="font-medium">{tp('goal')}</dt>
                <dd>{stage.goal}</dd>
                <dt className="font-medium">{tp('doneWhen')}</dt>
                <dd>{stage.completion_signal}</dd>
                {stage.materials.length > 0 ? (
                  <>
                    <dt className="font-medium">{tp('uses')}</dt>
                    <dd>{stage.materials.map((id) => itemName.get(id) ?? id).join('; ')}</dd>
                  </>
                ) : null}
              </dl>
              <p className="text-sm font-medium">{tp('restsOn')}</p>
              <ClaimList claims={stage.claims} />
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="self-check-heading" className="flex flex-col gap-2">
        <h3 id="self-check-heading" className="text-base font-medium">
          {tp('selfCheckTitle')}
        </h3>
        <ul className="flex list-disc flex-col gap-1 pl-5 text-sm">
          {plan.self_check.map((question, index) => (
            <li key={`${index}-${question}`}>{question}</li>
          ))}
        </ul>
      </section>

      <p className="text-xs text-muted-foreground">{tp('agentsWords')}</p>
    </section>
  );
};
