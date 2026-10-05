# SAMPLE starter code for the Crew Scaler "Agentic AI Foundations" demo course.
# Download-only: the platform never executes uploaded code.

def agent_loop(goal, tools, max_steps=5):
    """Observe -> plan -> act -> check, until the goal is met or steps run out."""
    history = []
    for step in range(max_steps):
        plan = f"step {step}: work toward {goal!r}"
        history.append(plan)
        if step == 2:
            break
    return history


if __name__ == "__main__":
    print(agent_loop("summarize a document", tools=[]))
