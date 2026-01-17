function runAfterMinutes(minutes) {
  return new Date(Date.now() + minutes * 60 * 1000);
}

export default runAfterMinutes;