const PROJECT_STAGE_ORDER = [
  "uploaded",
  "preprocessing",
  "detecting_bpm",
  "separating_vocals",
  "transcribing",
  "detecting_pitch",
  "aligning",
];

function contains(value, query) {
  return String(value ?? "").toLocaleLowerCase().includes(String(query ?? "").trim().toLocaleLowerCase());
}

function timestamp(value) {
  const result = Date.parse(value ?? "");
  return Number.isFinite(result) ? result : null;
}

export function filterProjects(projects, filters, stageLabel = (stage) => stage ?? "") {
  const createdFrom = timestamp(filters.createdFrom);
  const createdTo = timestamp(filters.createdTo);
  const updatedFrom = timestamp(filters.updatedFrom);
  const updatedTo = timestamp(filters.updatedTo);
  return projects.filter((project) => {
    const createdAt = timestamp(project.createdAt);
    const updatedAt = timestamp(project.updatedAt);
    const stage = `${project.furthestCompletedStage ?? ""} ${stageLabel(project.furthestCompletedStage)}`;
    return contains(project.jobId, filters.jobId)
      && contains(project.sourceFilename, filters.sourceFilename)
      && contains(stage, filters.furthestCompletedStage)
      && (createdFrom == null || (createdAt != null && createdAt >= createdFrom))
      && (createdTo == null || (createdAt != null && createdAt <= createdTo))
      && (updatedFrom == null || (updatedAt != null && updatedAt >= updatedFrom))
      && (updatedTo == null || (updatedAt != null && updatedAt <= updatedTo));
  });
}

export function sortProjects(projects, sort, locale = "en") {
  const direction = sort.direction === "asc" ? 1 : -1;
  const collator = new Intl.Collator(locale, { numeric: true, sensitivity: "base" });
  const stageIndex = (stage) => {
    const index = PROJECT_STAGE_ORDER.indexOf(stage);
    return index === -1 ? -1 : index;
  };
  const compare = (left, right) => {
    if (["createdAt", "updatedAt"].includes(sort.key)) {
      return (timestamp(left[sort.key]) ?? 0) - (timestamp(right[sort.key]) ?? 0);
    }
    if (sort.key === "furthestCompletedStage") {
      return stageIndex(left.furthestCompletedStage) - stageIndex(right.furthestCompletedStage);
    }
    return collator.compare(String(left[sort.key] ?? ""), String(right[sort.key] ?? ""));
  };
  return [...projects].sort((left, right) => {
    const result = compare(left, right);
    return result === 0 ? collator.compare(left.jobId, right.jobId) : result * direction;
  });
}

export function selectableProjectIds(projects, activeJobId) {
  return projects.filter((project) => project.jobId !== activeJobId).map((project) => project.jobId);
}
