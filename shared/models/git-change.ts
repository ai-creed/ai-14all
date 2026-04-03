export type GitChangeStatus = "M" | "A" | "D" | "R" | "??";

export type GitChange = {
  path: string;
  status: GitChangeStatus;
};
