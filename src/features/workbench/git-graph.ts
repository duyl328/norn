import type { GitGraphCommit, GitLogCommit } from "./types";

/**
 * 给提交分配泳道列号，用于画提交图谱。
 * 标准做法：lanes[i] 记录该泳道「下一条期望出现的提交 hash」。
 * 处理到某提交时，占用其被预定的泳道（无则取空闲/新建），把同样期望它的其它泳道合并掉，
 * 然后让该泳道继续指向它的第一父提交，其余父提交（合并）各开新泳道。
 */
export function assignGraphColumns(commits: GitLogCommit[]): GitGraphCommit[] {
  const lanes: (string | null)[] = [];
  const result: GitGraphCommit[] = [];

  const takeLane = (hash: string | null): number => {
    const free = lanes.indexOf(null);
    if (free !== -1) {
      lanes[free] = hash;
      return free;
    }
    lanes.push(hash);
    return lanes.length - 1;
  };

  for (const commit of commits) {
    let column = lanes.indexOf(commit.hash);
    if (column === -1) {
      column = takeLane(commit.hash);
    }

    // 合并所有同样在等这条提交的泳道（多个子提交指向它）。
    for (let i = 0; i < lanes.length; i += 1) {
      if (i !== column && lanes[i] === commit.hash) {
        lanes[i] = null;
      }
    }

    result.push({ ...commit, column });

    const [firstParent, ...otherParents] = commit.parents;
    lanes[column] = firstParent ?? null;
    for (const parent of otherParents) {
      if (lanes.indexOf(parent) === -1) {
        takeLane(parent);
      }
    }
  }

  return result;
}
