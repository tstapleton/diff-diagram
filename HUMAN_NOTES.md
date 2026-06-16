i'd like you to work on these tasks. please divide them up however you see fit - more can be on one worktree when it makes sense, e.g. maybe 1, 7, 8 are in similar code areas. please create a plan using superpowers for the appropriate ones:

done 1 - path subtitle on oos nodes

deferred 2 — type-only import detection + node styling

review later 3 - visual regression test - produce an image of both the all nodes and diff-focused views based on the fake angular app. create a test that verifies there are no regressions when a code change has been made. the reference image should be committed to the repo so new commits that change the image can be viewed in a diff. we might need to enable git-lfs in the repo. before starting to code this, please create a plan using superpowers, including technology and approach options.

deferred 4 - Style the nodes differently based on amount of changes in the file, e.g. a file with one changed line should be different visually than a file with 1000 lines changed. it doesn't need to be the entire node background, but it can be. please pick one that is minimal and well designed. describe other choices in a report with the reasoning for selecting the chosen one.

deferred 5 - group files inside the scope container on the diagram based on their top-most directory inside the scope directory. for the fake angular app, this would be data-access, models, shared-ui, etc. just one level - e.g. don't need to differentiate data-access/store from data-access.

done 6 - like with unit tests, *.stories.ts, should not be shown on the diagram. please make sure there is a .stories.ts file in the fake angular app so we can see this working.

done 7 - it seems like there are a limited set of file types for the nodes, e.g. service, constants, resolver, etc. this doesn't seem to provide any value. please remove.

done 8 - added, unchanged, etc are labels inside the node. it looks like they describe the edges to them though, which breaks when a node has both an unchanged import and an added import. and some information being inside the node seems like it should represent the node, rather than an edge. please remove.

done 9 - how are the edges classified? i see new, removed, unchanged. what about modified? e.g. in the base, file a imports foo from file b and in the new version, file a imports foo and bar from file b.

what questions do you have?

--- sent next message

## task 2
- we probably do `import { X }` rather than `import type { X }`. is that going to be a problem?

## task 3
- please make the command `test:visual` to evaluate it and `test:visual:approve` to update it.
- skip the svg has correct dimensions test - that isn't a requirement
- don't want this included in the normal unit test runs - don't we need to regenerate the diagram before running the test? can't assume that there is always output that reflects the current state

## task 4
- need something more visual than a 4px bar difference.
- did 1-15, 16-50, etc come from something? is that industry common industry standards? it seems like it would skew large

## task 5
- i don't understand this: "Only rendered when there are ≥ 2 distinct subdirs in scope (single subdir = no grouping)"
  - if feature/foo/a.ts, feature/c.ts, then we should see a foo group.
  - if feature/foo/bar/a.ts, feature/foo/b.ts, feature/c.ts, then we should see a foo group that contains a.ts and b.ts, and no mention of bar anywhere.
- move the excluded patterns to the top of a file and treat as a constant - feels more configuration than code

## task 6
- create an example of this in the fake angular app so we can have it included in the visual tests (part of another task)

--- sent next message

## task 1
- the paths extend outside the node - like the box doesn't extend to the longer lengths
- we'll want to remove the start of the paths. i want "src/app" removed. maybe this is a cli argument that is defaulted to "src/app". re naming, if that is called something in an angular app, please following naming
- the two lines in the out of scope nodes are not centered inside the node. please center them.

## task 2
- yes, let's defer it. please create a document to capture future work ideas and describe the request in detail, the reasons why we are not doing it now, and options for moving forward. we'll add more stuff to this document later.

## task 9
- please update the legend with new modified import

--- not yet sent

## task 5
- that didn't work - everything is in the workspace container. please revert these changes and add another item to the future work document.

## task 4
- commit it please.

--- sent

10 - add some marker on files for 1) when they have a unit test, 2) when they have an associated storybook story. both can identify using the file path name, e.g. foo.component.ts, foo.stories.ts, foo.spec.ts would show a foo node with both the storybook and test markers

11 - can we simplify the cli command? do all those need to be provided? the base dir seems duplicate of the scope dir, no? default the out-dir to dist and accept an override as an argument. i think `node dist/cli.js --FOO-repo-root fake-angular-app --base-repo-root fake-angular-app-base src/app/features/users` is enough and is clear. for FOO, maybe an appropriate git term?

12 - are the modified/changed colors consistent between node, edge, and changed files. are the greens and reds the same color?

13 - commit the plans to the repo. what is SOP for worktrees in the repo, e.g. add to git ignore?

14 - when hovering over a node, the arrows get bigger. this doesn't look good. please fix.

15 - add a future work item for doing something different for grouping nodes outside the feature directory. this was task 1 before and we went with the simpler option first. the future work item could be the second option.

--- sent

i'd like the documentation updated and aligned to the codebase. i'm thinking things like:
1) has the codebase drifted from the architecture docs? for each place there has been drift, should the documentation or codebase be updated?
2) make sure codebase reflects the correct names, and we are consistent with naming. i'd like "feature directory" to be the name of the thing that has all the in scope nodes.
3) write a glossary describing common terms
4) the readme should be human consumable, concise, understandable.
5) we created a plans directory and we still have some .md files at the root of the repo. perhaps there should be a docs directory, and the earlier docs should be collected in there.

maybe there is more?

please write a plan for how to address these. maybe order matters? i'll review the plan before you implement any changes.

--- not yet sent

XX - you are a staff software engineer. evaluate the codebase. where is it strong? where is it weak? how could those weak areas be improved? look at the big picture and small details. look for test cases that aren't useful, e.g. only verify implementation, verify non-useful behavior, etc. ensure tests are good, complete, maintainable, appropriate, etc.