import { fetchAuthSession } from "@aws-amplify/auth";
import { apiEndpoint } from "./Chatbot";


// Function to retrieve a session token from Cognito with the currently authenticated user
export const getToken = async () => {
  try {
    const session = await fetchAuthSession(); // Fetch the current authentication session

    if (!session.tokens?.idToken) {
      throw new Error("No access token found");
    }
  
    return `Bearer ${session.tokens?.idToken}`; // return the bearer token for the user
  } catch (error) {
    console.error("Error getting auth token:", error);
    throw error;
  }
};

interface MessageRequest {
  message: string;
  id: string; 
}

export const postMessage = async (requestData: MessageRequest) => {
  try {
    const token = await getToken(); // retrieve the bearer token for the user 
    
    const res = await fetch(`${apiEndpoint}/nlq`, {
      method: 'POST',
      headers: {
        "Authorization": token, // pass the cognito token to authorize our API call
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestData) 
    });
    
    const responseData = await res.json();
    
    if (!res.ok) {
      // catches 500 errors from Lambda and passes them to catch
      throw new Error(responseData?.answer || `API error: ${res.status} ${res.statusText}`);
    }
    
    return { success: true, data: responseData }; 
    
  } catch (error: any) {
    // for network errors (gateway timeouts, etc.) fetch will not return a response
    console.error("Error posting message:", error);
    
    const errorMessage =
      error.message.includes("Failed to fetch") || error.message.includes("NetworkError")
        ? "Network error: Unable to reach server. Please check your connection."
        : error.message; // Return detailed error from API response

    return { success: false, message: errorMessage };
  }
};

