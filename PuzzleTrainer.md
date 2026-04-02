📑 Specification: The Socratic Engine Wrapper or Active Internalization. ObjectiveTo eliminate "Guess-and-Check" behavior (The Gamification
Glitch) by forcing the user to pass three Engine-Validated Logic Gates before the PGN solution moves are unlocked
The puzzle view should have a toggle called: "Stoyko Mode." When enabled, the user must pass three logic gates to access the solution moves.

Technical ArchitectureData Source: Standard PGN (Initial FEN + Solution Path).Validation Layer: Stockfish WASM (running
in a Web Worker) to "interrogate" the FEN.State Machine: LOCKED -> SCAN_COMPLETE -> CANDIDATE_SUBMITTED ->
PROPHYLAXIS_VALIDATED -> SOLVE_ENABLED.3. Logic Gate RequirementsGate 1: Signal Identification (LPDO & King Safety)The
app must identify "Tactical Seeds" that aren't labeled in the PGN.Requirement: User must click all "Loose Pieces" (LPDO)
.Engine Logic: * Iterate through board.pieces().For each piece: if (attackers.length > 0 && defenders.length === 0) ->
Add to RequiredClicks.UX: Board is a "Heatmap." Correct clicks turn green; missing a click prevents moving to Gate
2.Gate 2: The "Candidate" CommitmentPrevents the "First-Move Reflex."Requirement: User must select the start square of
three different pieces.Logic: The app records these as User_Candidates.Validation: Compare against Engine Top 3 moves (
engine.analyze(depth=15)).Feedback: If the PGN move is NOT in the user's 3 candidates, the app triggers a "Tunnel
Vision" warning.Gate 3: The Prophylaxis Test (Best Defense)Forces the user to see the opponent's resources (Raising the
Floor).Requirement: "If you play [PGN Move 1], what is the opponent's strongest response?"Engine Logic:Execute
board.move(PGN_Move_1).Call engine.getBestMove().Generate a Multiple
Choice: [Engine_Best_Move (Correct)], [Random_Legal_Move (Distractor)], [Passive_King_Move (Distractor)].Constraint: If
the user chooses a "Distractor," the puzzle is marked as a Logic Fail, even if they eventually find the winning moves.4.
Spaced Repetition (SR) IntegrationThe "Success" of a puzzle is now a weighted average.FactorWeightPenaltyMove
Accuracy40%Failure = Immediate ResetGate Accuracy40%Failure = Interval reduced by 50%Solve Speed20%$< 10s$ =
Bonus; $> 60s$ = Neutral