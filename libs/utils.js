const slugify = (text) => {
  const from = 'ãàáäâẽèéëêìíïîõòóöôùúüûñç·/_,:;';
  const to = 'aaaaaeeeeeiiiiooooouuuunc------';

  const normalized = String(text || '')
    .split('')
    .map((letter, i) => letter.replace(new RegExp(from.charAt(i), 'g'), to.charAt(i)))
    .join('');

  return normalized
    .toLowerCase()
    .trim()
    .replace(/\s+/g, '-')
    .replace(/&/g, '-y-')
    .replace(/[^\w-]+/g, '')
    .replace(/--+/g, '-');
};

const arrayToObj = (arr = []) => {
  const obj = {};
  for (let i = 0; i < arr.length; i += 2) {
    const key = arr[i];
    const value = arr[i + 1];
    if (key !== undefined) {
      obj[key] = value;
    }
  }
  return obj;
};

module.exports = {
  slugify,
  arrayToObj,
};
