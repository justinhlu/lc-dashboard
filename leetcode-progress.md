# LeetCode FAANG Prep — Progress

Plan: `~/.claude/learning/plans/leetcode-2026-04-18.json`
Started: 2026-04-18

**How to log a problem:**
- **Time (min):** total minutes from first read to working solution. If you gave up, log the minutes spent + `GAVE UP`.
- **Solo?:** `Y` = solved with zero hints/solutions. `H` = used a hint (but not the solution). `N` = read the solution.
- **Status:** `fluent` = could re-solve cold next day · `revisit` = slow, hinted, or barely passed · blank = not attempted yet.
- **Target times:** easy ≤ 15 min · medium ≤ 25 min · hard ≤ 40 min.
- `(key)` = must-be-fluent problem — don't move on until `solo=Y` and within target time.

---

## Module 1: Arrays, Hashing & Two Pointers

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Two Sum | easy | hash map |  |  |  |
| Contains Duplicate | easy | hash set |  |  |  |
| Valid Anagram | easy | hash / sort |  |  |  |
| Group Anagrams | medium | hash w/ tuple key |  |  |  |
| Top K Frequent Elements | medium | hash + heap / bucket |  |  |  |
| Product of Array Except Self | medium | prefix/suffix products |  |  |  |
| Valid Palindrome | easy | two pointers |  |  |  |
| 3Sum (key) | medium | sort + two pointers |  |  |  |
| Container With Most Water | medium | two pointers |  |  |  |
| Trapping Rain Water | hard | two pointers + max-so-far |  |  |  |
| Subarray Sum Equals K (key) | medium | prefix + hash |  |  |  |
| Linked List Cycle | easy | fast/slow |  |  |  |
| Find the Duplicate Number | medium | Floyd's on index graph |  |  |  |

## Module 2: Sliding Window

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Best Time to Buy and Sell Stock | easy | min-so-far |  |  |  |
| Longest Substring Without Repeating Chars (key) | medium | variable window + hash |  |  |  |
| Longest Repeating Character Replacement | medium | window + freq map |  |  |  |
| Permutation in String | medium | fixed window + freq |  |  |  |
| Minimum Window Substring (key) | hard | window + need/have counters |  |  |  |
| Sliding Window Maximum | hard | monotonic deque |  |  |  |

## Module 3: Stack & Monotonic Stack

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Valid Parentheses | easy | stack |  |  |  |
| Min Stack | medium | two stacks / pair stack |  |  |  |
| Evaluate Reverse Polish Notation | medium | stack |  |  |  |
| Generate Parentheses | medium | backtracking on stack |  |  |  |
| Daily Temperatures (key) | medium | monotonic stack |  |  |  |
| Car Fleet | medium | sort + stack |  |  |  |
| Largest Rectangle in Histogram (key) | hard | monotonic stack |  |  |  |

## Module 4: Binary Search

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Binary Search | easy | lower/upper bound |  |  |  |
| Search a 2D Matrix | medium | flattened BS |  |  |  |
| Koko Eating Bananas (key) | medium | search on answer |  |  |  |
| Find Minimum in Rotated Sorted Array | medium | BS on pivot |  |  |  |
| Search in Rotated Sorted Array (key) | medium | BS on pivot |  |  |  |
| Time Based Key-Value Store | medium | BS on timestamps |  |  |  |
| Median of Two Sorted Arrays | hard | BS on partition |  |  |  |

## Module 5: Linked Lists, Trees & BFS/DFS

### Linked list

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Reverse Linked List | easy | iter/recursion |  |  |  |
| Merge Two Sorted Lists | easy | dummy node |  |  |  |
| Reorder List | medium | mid + reverse + merge |  |  |  |
| Remove Nth Node From End of List | medium | two pointers |  |  |  |
| Copy List with Random Pointer | medium | hash / interleave |  |  |  |
| Add Two Numbers | medium | carry |  |  |  |
| LRU Cache (key) | medium | hash + doubly linked list |  |  |  |
| Merge k Sorted Lists | hard | heap / divide and conquer |  |  |  |
| Reverse Nodes in k-Group | hard | in-place reverse |  |  |  |

### Trees

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Invert Binary Tree | easy | DFS |  |  |  |
| Maximum Depth of Binary Tree | easy | DFS/BFS |  |  |  |
| Diameter of Binary Tree | easy | post-order |  |  |  |
| Balanced Binary Tree | easy | post-order |  |  |  |
| Same Tree | easy | DFS |  |  |  |
| Subtree of Another Tree | easy | DFS |  |  |  |
| Lowest Common Ancestor of a BST | medium | BST property |  |  |  |
| Binary Tree Level Order Traversal (key) | medium | BFS |  |  |  |
| Binary Tree Right Side View | medium | BFS last per level |  |  |  |
| Count Good Nodes | medium | DFS w/ max |  |  |  |
| Validate Binary Search Tree | medium | DFS w/ bounds |  |  |  |
| Kth Smallest Element in a BST | medium | in-order |  |  |  |
| Construct Binary Tree from Preorder and Inorder (key) | medium | recursion + hash |  |  |  |
| Binary Tree Maximum Path Sum (key) | hard | tree DP |  |  |  |
| Serialize and Deserialize Binary Tree (key) | hard | preorder + nulls |  |  |  |

## Module 6: Graphs — Topological Sort, Union-Find, Dijkstra

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Number of Islands (key) | medium | BFS/DFS on grid |  |  |  |
| Clone Graph | medium | DFS + hash |  |  |  |
| Max Area of Island | medium | DFS on grid |  |  |  |
| Pacific Atlantic Water Flow | medium | multi-source BFS |  |  |  |
| Surrounded Regions | medium | border DFS |  |  |  |
| Rotting Oranges | medium | multi-source BFS |  |  |  |
| Walls and Gates | medium | multi-source BFS |  |  |  |
| Course Schedule (key) | medium | topo sort |  |  |  |
| Course Schedule II | medium | topo sort |  |  |  |
| Redundant Connection (key) | medium | union-find |  |  |  |
| Number of Connected Components | medium | union-find |  |  |  |
| Graph Valid Tree | medium | union-find / DFS |  |  |  |
| Word Ladder | hard | BFS |  |  |  |
| Network Delay Time (key) | medium | Dijkstra |  |  |  |
| Swim in Rising Water | hard | Dijkstra / BS + BFS |  |  |  |
| Cheapest Flights Within K Stops | medium | Bellman-Ford / Dijkstra |  |  |  |
| Alien Dictionary (key) | hard | topo sort |  |  |  |

## Module 7: Heaps, Intervals & Greedy

### Heap / priority queue

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Kth Largest Element in a Stream | easy | min-heap size K |  |  |  |
| Last Stone Weight | easy | max-heap |  |  |  |
| K Closest Points to Origin (key) | medium | heap / quickselect |  |  |  |
| Kth Largest Element in an Array | medium | heap / quickselect |  |  |  |
| Task Scheduler | medium | heap + cooldown |  |  |  |
| Design Twitter | medium | heap + hash |  |  |  |
| Find Median from Data Stream (key) | hard | two heaps |  |  |  |

### Intervals

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Insert Interval | medium | linear scan |  |  |  |
| Merge Intervals (key) | medium | sort + merge |  |  |  |
| Non-overlapping Intervals | medium | greedy end-sort |  |  |  |
| Meeting Rooms | easy | sort + scan |  |  |  |
| Meeting Rooms II (key) | medium | heap / sweep line |  |  |  |
| Minimum Interval to Include Each Query | hard | heap + sort |  |  |  |

### Greedy

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Maximum Subarray | medium | Kadane's |  |  |  |
| Jump Game | medium | greedy reach |  |  |  |
| Jump Game II | medium | greedy BFS |  |  |  |
| Gas Station | medium | running sum |  |  |  |
| Hand of Straights | medium | sort + count |  |  |  |
| Merge Triplets to Form Target | medium | greedy filter |  |  |  |
| Partition Labels (key) | medium | last-index greedy |  |  |  |
| Valid Parenthesis String | medium | range of opens |  |  |  |

## Module 8: Dynamic Programming (deep dive — weak area)

### 1D DP

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Climbing Stairs | easy | Fibonacci |  |  |  |
| Min Cost Climbing Stairs | easy | Fibonacci |  |  |  |
| House Robber (key) | medium | 1D DP |  |  |  |
| House Robber II | medium | 1D DP twice |  |  |  |
| Longest Palindromic Substring | medium | expand / DP |  |  |  |
| Palindromic Substrings | medium | expand / DP |  |  |  |
| Decode Ways (key) | medium | 1D DP |  |  |  |
| Coin Change (key) | medium | unbounded knapsack |  |  |  |
| Maximum Product Subarray | medium | track min & max |  |  |  |
| Word Break (key) | medium | 1D DP + set |  |  |  |
| Longest Increasing Subsequence (key) | medium | DP O(n log n) |  |  |  |
| Partition Equal Subset Sum | medium | 0/1 knapsack |  |  |  |

### 2D DP

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Unique Paths | medium | grid DP |  |  |  |
| Longest Common Subsequence (key) | medium | 2D DP |  |  |  |
| Best Time to Buy and Sell Stock with Cooldown | medium | state machine |  |  |  |
| Coin Change II | medium | unbounded knapsack count |  |  |  |
| Target Sum | medium | subset sum |  |  |  |
| Interleaving String | medium | 2D DP |  |  |  |
| Longest Increasing Path in a Matrix | hard | DFS + memo |  |  |  |
| Distinct Subsequences | hard | 2D DP |  |  |  |
| Edit Distance (key) | hard | 2D DP |  |  |  |
| Burst Balloons | hard | interval DP |  |  |  |
| Regular Expression Matching | hard | 2D DP |  |  |  |

## Module 9: Backtracking, Tries, Bit + Mock Interviews

### Backtracking

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Subsets | medium | backtracking |  |  |  |
| Combination Sum | medium | backtracking |  |  |  |
| Permutations (key) | medium | backtracking |  |  |  |
| Subsets II | medium | backtracking + dedup |  |  |  |
| Combination Sum II | medium | backtracking + dedup |  |  |  |
| Word Search (key) | medium | backtracking on grid |  |  |  |
| Palindrome Partitioning | medium | backtracking |  |  |  |
| Letter Combinations of a Phone Number | medium | backtracking |  |  |  |
| N-Queens | hard | backtracking |  |  |  |

### Tries

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Implement Trie (key) | medium | trie |  |  |  |
| Design Add and Search Words Data Structure | medium | trie + DFS |  |  |  |
| Word Search II (key) | hard | trie + backtracking |  |  |  |

### Bit manipulation

| Problem | Diff | Pattern | Time | Solo? | Status |
|---|---|---|---|---|---|
| Single Number | easy | XOR |  |  |  |
| Number of 1 Bits | easy | bit tricks |  |  |  |
| Counting Bits | easy | DP on bits |  |  |  |
| Reverse Bits | easy | bit shift |  |  |  |
| Missing Number | easy | XOR / sum |  |  |  |
| Sum of Two Integers | medium | XOR + carry |  |  |  |

### Mock interviews (timed — 25 min medium, 40 min hard)

| # | Date | Platform | Problems | Result | Notes |
|---|---|---|---|---|---|
| 1 | | | | | |
| 2 | | | | | |
| 3 | | | | | |
| 4 | | | | | |
| 5 | | | | | |

---

## Notes / weak spots to revisit

(Add any `revisit` problem here with a one-line reminder of what tripped you up.)

- _example_ — 3Sum — forgot to skip duplicates on the outer loop, TLE
- 3sum - forgot to skip duplicates in the outer loop and instead solved using a set
- Longest Substring Without Repeating Characters - Tried to solve with sliding window without using a set