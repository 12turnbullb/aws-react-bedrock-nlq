import { fetchAuthSession } from "@aws-amplify/auth";
import { apiEndpoint } from "./App";

export const getToken = async () => {
  try {
    const session = await fetchAuthSession(); // Fetch the current authentication session

    if (!session.tokens?.idToken) {
      throw new Error("No access token found");
    }

    return `Bearer ${session.tokens?.idToken}`;
  } catch (error) {
    console.error("Error getting auth token:", error);
    throw error;
  }
};

interface Time {
  cur_date: string;
}

export const getTime = async () => {
  try {
    const token = await getToken();
        const res = await fetch(`${apiEndpoint}/api/time`, {
      headers: {
        "Authorization": token,
        "Content-Type": "application/json",
      },
    });
    
    if (!res.ok) {
      throw new Error(`API request failed with status ${res.status}`);
    }

    return (await res.json()) as Time;
  } catch (error) {
    console.error("Error fetching time:", error);
    throw error;
  }
};

export const postTime = async (requestData: TimeRequest) => {
  try {
    const token = await getToken();
    const res = await fetch(`${apiEndpoint}/api/nlq`, {
      method: 'POST', // specify POST method
      headers: {
        "Authorization": token,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData) // add the request body
    });
    
    if (!res.ok) {
      throw new Error(`API request failed with status ${res.status}`);
    }

    return (await res.json()) as Time;
  } catch (error) {
    console.error("Error posting time:", error);
    throw error;
  }
};

